import json
import mimetypes
import uuid
import time
from aiohttp import web
from server import PromptServer
from . import utils

import folder_paths
from pathlib import Path

NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = "./web"

SUPPORTED_EXTENSIONS = {
    "model": ["ckpt", "safetensors", "pt", "pth", "gguf"],
    "image": ["jpg", "jpeg", "bmp", "png", "webp", "gif"],
    "video": ["mp4", "webm"],
    "audio": ["ogg", "wav", "mp3", "webm"]
}

routes = PromptServer.instance.routes

# 一時トークン → 実ファイルパス のマッピング（TTL付き）
media_cache = {}
TOKEN_EXPIRE_TIME = 3600  # 1時間でトークン無効化

# ===============================================
# ユーティリティ
# ===============================================
def list_registered_paths():
    """ComfyUIで登録された全てのパスを取得"""
    all_paths = set()
    try:
        for paths, _exts in folder_paths.folder_names_and_paths.values():
            for p in paths:
                resolved_path = Path(p).resolve()
                if resolved_path.exists():
                    all_paths.add(str(resolved_path))
        
        # inputディレクトリも追加
        input_dir = folder_paths.get_input_directory()
        input_path = Path(input_dir).resolve()
        if input_path.exists():
            all_paths.add(str(input_path))
    except Exception as e:
        print(f"Error listing paths: {e}")
    
    return all_paths

def find_full_path(relative_path: str):
    """相対パスから実際のファイルパスを検索"""
    if not relative_path:
        return None
    
    try:
        # セキュリティチェック: パストラバーサル攻撃を防ぐ
        if ".." in relative_path or relative_path.startswith("/"):
            return None
        
        for base_dir in list_registered_paths():
            candidate = Path(base_dir) / relative_path
            resolved_candidate = candidate.resolve()
            
            # セキュリティチェック: ベースディレクトリ外へのアクセスを防ぐ
            if not str(resolved_candidate).startswith(str(Path(base_dir).resolve())):
                continue
                
            if resolved_candidate.exists() and resolved_candidate.is_file():
                return str(resolved_candidate)
    except Exception as e:
        print(f"Error finding path for {relative_path}: {e}")
    
    return None

def get_extension_category(ext: str):
    """拡張子からカテゴリを判定"""
    if not ext:
        return None
    
    ext = ext.lower().lstrip('.')
    for category, exts in SUPPORTED_EXTENSIONS.items():
        if ext in exts:
            return category
    return None

def cleanup_expired_tokens():
    """期限切れトークンをクリーンアップ"""
    current_time = time.time()
    expired_tokens = [
        token for token, data in media_cache.items()
        if current_time - data.get("created_at", 0) > TOKEN_EXPIRE_TIME
    ]
    
    for token in expired_tokens:
        del media_cache[token]
    
    return len(expired_tokens)

# ===============================================
# APIエンドポイント
# ===============================================

@routes.get(utils._endpoint("supportedExtensions"))
async def get_supported_extensions(request: web.Request):
    """サポートされている拡張子一覧を返す"""
    try:
        return web.json_response(SUPPORTED_EXTENSIONS)
    except Exception as e:
        print(f"Error getting supported extensions: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)

@routes.post(utils._endpoint("mediaPath"))
async def get_media_path(request: web.Request):
    """モデルパスからメディア用トークンを取得"""
    try:
        # 期限切れトークンをクリーンアップ
        cleanup_expired_tokens()
        
        data = await request.json()
        relative_path = data.get("path", "").strip()
        
        if not relative_path:
            return web.json_response({"token": "", "category": ""})

        full_path_str = find_full_path(relative_path)
        if not full_path_str:
            return web.json_response({"token": "", "category": ""})
        
        full_path = Path(full_path_str)
        ext = full_path.suffix.lstrip(".").lower()
        category = get_extension_category(ext)

        # 直接メディアファイルの場合
        if category in ("image", "video", "audio"):
            token = str(uuid.uuid4())
            media_cache[token] = {
                "path": str(full_path),
                "category": category,
                "created_at": time.time()
            }
            return web.json_response({"token": token, "category": category})

        # モデルファイルの場合、同名のメディアファイルを探す
        if category == "model":
            stem = full_path.stem
            parent_dir = full_path.parent
            
            for media_category in ("image", "video", "audio"):
                for media_ext in SUPPORTED_EXTENSIONS[media_category]:
                    # 候補ファイルのリスト
                    candidates = [
                        # 同名ファイル
                        parent_dir / f"{stem}.{media_ext}", 
                        # プレビュー専用ファイル
                        parent_dir / f"{stem}.preview.{media_ext}",
                    ]
                    
                    # 候補を順番にチェック
                    for candidate in candidates:
                        if candidate.exists() and candidate.is_file():
                            token = str(uuid.uuid4())
                            media_cache[token] = {
                                "path": str(candidate),
                                "category": media_category,
                                "created_at": time.time()
                            }
                            return web.json_response({"token": token, "category": media_category})

        # メディアファイルが見つからない場合
        return web.json_response({"token": "", "category": ""})
        
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"Error processing media path request: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)

@routes.get("/media")
async def serve_media(request: web.Request):
    """トークン経由でメディアファイルを配信"""
    try:
        token = request.query.get("token", "").strip()
        if not token:
            return web.Response(status=400, text="Token required")
        
        media_data = media_cache.get(token)
        if not media_data:
            return web.Response(status=404, text="Token not found or expired")
        
        file_path = media_data.get("path")
        if not file_path:
            return web.Response(status=404, text="File path not found")
        
        path_obj = Path(file_path)
        if not path_obj.exists() or not path_obj.is_file():
            # ファイルが存在しない場合、キャッシュからも削除
            del media_cache[token]
            return web.Response(status=404, text="File not found")

        # MIMEタイプを推定
        mime_type, encoding = mimetypes.guess_type(file_path)
        if not mime_type:
            # デフォルトのMIMEタイプを設定
            category = media_data.get("category", "")
            if category == "image":
                mime_type = "image/jpeg"
            elif category == "video":
                mime_type = "video/mp4"
            elif category == "audio":
                mime_type = "audio/mpeg"
            else:
                mime_type = "application/octet-stream"

        # 🔥 修正: headersでcontent-typeを指定（これがエラーの原因でした！）
        headers = {"Content-Type": mime_type}
        if encoding:
            headers["Content-Encoding"] = encoding

        return web.FileResponse(file_path, headers=headers)
        
    except Exception as e:
        print(f"Error serving media: {e}")
        return web.Response(status=500, text="Internal server error")

@routes.get(utils._endpoint("cacheStatus"))
async def get_cache_status(request: web.Request):
    """キャッシュの状態を確認（デバッグ用）"""
    try:
        cleaned = cleanup_expired_tokens()
        return web.json_response({
            "active_tokens": len(media_cache),
            "cleaned_tokens": cleaned
        })
    except Exception as e:
        print(f"Error getting cache status: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)