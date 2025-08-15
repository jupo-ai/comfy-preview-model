import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { debug, _name, _endpoint, api_get, api_post } from "./utils.js";

const SupportedExtensions = await api_get("supportedExtensions");

// ===============================================
// Preview Manager - プレビュー管理クラス
// ===============================================
class MediaPreviewManager {
    constructor() {
        // 基本設定
        this.enabled = true;
        this.previewHeight = 200;
        this.currentPreview = null;
        
        // 動画設定
        this.videoVolume = 0.5;
        this.videoAutoplay = false;
        this.videoLoop = false;
        
        // 音声設定
        this.audioVolume = 0.5;
        this.audioAutoplay = false;
        this.audioLoop = false;
        
        // 位置調整用のプロパティ
        this.previewMaxWidth = 400;      // プレビューの最大幅
        this.audioMaxWidth = 320;        // 音声プレビューの最大幅
        this.audioWidth = 300;           // 音声要素の幅
        this.margin = 10;                // プレビューとメニューの間隔
        this.screenMargin = 10;          // 画面端からの余白
        this.paddingExtra = 20;          // 高さ計算時の余裕（パディング+α）
        
        // プレビュー要素を作成
        this.createPreviewElements();
    }
    
    // 個別の設定更新メソッド
    setEnabled(value) {
        this.enabled = value;
    }
    
    setPreviewHeight(value) {
        this.previewHeight = value;
        if (this.previewContainer) {
            this.previewContainer.style.maxHeight = `${value}px`;
        }
    }
    
    setVideoVolume(value) {
        this.videoVolume = value;
        // 現在再生中の動画があれば音量を更新
        const videos = this.previewContainer?.querySelectorAll(".jupo-media-preview-video");
        videos?.forEach(video => {
            video.volume = value;
        });
    }
    
    setVideoAutoplay(value) {
        this.videoAutoplay = value;
    }
    
    setVideoLoop(value) {
        this.videoLoop = value;
        // 現在再生中の動画があればループ設定を更新
        const videos = this.previewContainer?.querySelectorAll(".jupo-media-preview-video");
        videos?.forEach(video => {
            video.loop = value;
        });
    }
    
    setAudioVolume(value) {
        this.audioVolume = value;
        // 現在再生中の音声があれば音量を更新
        const audios = this.previewContainer?.querySelectorAll(".jupo-media-preview-audio");
        audios?.forEach(audio => {
            audio.volume = value;
        });
    }
    
    setAudioAutoplay(value) {
        this.audioAutoplay = value;
    }
    
    setAudioLoop(value) {
        this.audioLoop = value;
        // 現在再生中の音声があればループ設定を更新
        const audios = this.previewContainer?.querySelectorAll(".jupo-media-preview-audio");
        audios?.forEach(audio => {
            audio.loop = value;
        });
    }
    
    createPreviewElements() {
        this.previewContainer = $el("div.jupo-media-preview-container", {
            style: {
                position: "absolute",
                maxHeight: `${this.previewHeight}px`,
                maxWidth: `${this.previewMaxWidth}px`,
                zIndex: 9999999,
                display: "none",
                background: "rgba(0, 0, 0, 0.9)",
                border: "1px solid #555",
                borderRadius: "4px",
                padding: "4px"
            },
            parent: document.body,
        });
    }
    
    calculatePosition(element) {
        const body_rect = document.body.getBoundingClientRect();
        const element_rect = element.getBoundingClientRect();
        
        let left, top;
        
        // 横位置の計算
        if (body_rect.width && element_rect.right + this.previewMaxWidth > body_rect.width) {
            // 左側に表示
            left = element_rect.left - this.previewMaxWidth - this.margin;
        } else {
            // 右側に表示
            left = element_rect.right + this.margin;
        }
        
        // 縦位置の計算（はみ出し防止）
        top = element_rect.top;
        
        // プレビューの推定高さ（設定値 + パディング + 余裕）
        const estimated_preview_height = this.previewHeight + this.paddingExtra;
        
        // 下にはみ出す場合は上に移動
        if (top + estimated_preview_height > body_rect.height) {
            top = body_rect.height - estimated_preview_height - this.screenMargin;
        }
        
        // 画面外に出ないように調整
        if (left < 0) left = this.screenMargin;
        if (top < 0) top = this.screenMargin;
        
        return { left, top };
    }
    
    async showPreview(element, token, category) {
        if (!this.enabled || !token) return;
        
        try {
            const { left, top } = this.calculatePosition(element);
            const url = `/media?token=${token}`;
            
            // 既存のプレビューをクリア
            this.previewContainer.innerHTML = "";
            
            // プレビューコンテナの位置設定
            this.previewContainer.style.left = `${left}px`;
            this.previewContainer.style.top = `${top}px`;
            this.previewContainer.style.maxHeight = `${this.previewHeight}px`;
            
            let mediaElement;
            
            if (category === "image") {
                // 全ての画像（webpアニメーション含む）をimgタグで表示
                mediaElement = $el("img.jupo-media-preview-image", {
                    src: url,
                    style: {
                        maxHeight: `${this.previewHeight}px`,
                        maxWidth: "100%",
                        display: "block",
                        borderRadius: "2px"
                    },
                    crossOrigin: "anonymous"
                });
                
            } else if (category === "video") {
                // 動画は直接videoタグで表示
                mediaElement = $el("video.jupo-media-preview-video", {
                    src: url,
                    style: {
                        maxHeight: `${this.previewHeight}px`,
                        maxWidth: "100%",
                        display: "block",
                        borderRadius: "2px"
                    },
                    controls: true,
                    muted: !this.videoAutoplay, // 自動再生時のみミュート解除
                    volume: this.videoVolume,
                    loop: this.videoLoop,
                    crossOrigin: "anonymous"
                });
                
                // 動画の自動再生設定に応じた処理
                if (this.videoAutoplay) {
                    mediaElement.addEventListener('loadeddata', () => {
                        // 自動再生時はミュートを解除してから再生
                        mediaElement.muted = false;
                        mediaElement.play().catch(() => {
                            // 自動再生失敗時はミュートして再試行
                            mediaElement.muted = true;
                            mediaElement.play().catch(() => {
                                // それでも失敗した場合は諦める
                            });
                        });
                    });
                }
                
            } else if (category === "audio") {
                // 音声はaudioタグで表示
                mediaElement = $el("audio.jupo-media-preview-audio", {
                    src: url,
                    style: {
                        width: `${this.audioWidth}px`,
                        display: "block"
                    },
                    controls: true,
                    volume: this.audioVolume,
                    loop: this.audioLoop,
                    crossOrigin: "anonymous"
                });
                
                // 音声の自動再生設定に応じた処理
                if (this.audioAutoplay) {
                    mediaElement.addEventListener('loadeddata', () => {
                        mediaElement.play().catch(() => {
                            // 自動再生失敗は無視（コントロールで手動再生可能）
                        });
                    });
                }
                
                this.previewContainer.style.maxWidth = `${this.audioMaxWidth}px`;
            }
            
            if (mediaElement) {
                this.previewContainer.appendChild(mediaElement);
                this.previewContainer.style.display = "block";
                this.currentPreview = { type: category, element: mediaElement };
            }
            
        } catch (error) {
            console.warn("Failed to load media preview:", error);
        }
    }
    
    stopMedia() {
        // メディア要素の停止のみ（要素は残す）
        const videos = this.previewContainer.querySelectorAll(".jupo-media-preview-video");
        const audios = this.previewContainer.querySelectorAll(".jupo-media-preview-audio");
        
        videos.forEach(video => {
            if (!video.paused) {
                video.pause();
                video.currentTime = 0;
            }
        });
        
        audios.forEach(audio => {
            if (!audio.paused) {
                audio.pause();
            }
        });
    }
    
    hidePreview() {
        if (this.previewContainer) {
            this.previewContainer.style.display = "none";
            
            // メディア要素の停止とクリア
            this.stopMedia();
            
            // 要素をクリア
            this.previewContainer.innerHTML = "";
        }
        
        this.currentPreview = null;
    }
    
    cleanup() {
        this.hidePreview();
        if (this.previewContainer) {
            this.previewContainer.remove();
        }
    }
}

// ===============================================
// ユーティリティ関数
// ===============================================
function getItemText(value) {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value?.content) return value.content;
    return null;
}

function getItemExt(itemText) {
    if (typeof itemText !== "string") return "";
    const lastDotIndex = itemText.lastIndexOf(".");
    if (lastDotIndex === -1 || lastDotIndex === itemText.length - 1) return "";
    return itemText.slice(lastDotIndex + 1).toLowerCase();
}

function isSupportedItem(itemText) {
    const ext = getItemExt(itemText);
    return Object.values(SupportedExtensions).some(extensions => 
        extensions.includes(ext)
    );
}

function getItemPath(value) {
    const itemText = getItemText(value);
    if (!itemText || !isSupportedItem(itemText)) return null;
    
    // rgthree拡張との互換性
    if (value?.rgthree_originalValue) {
        return value.rgthree_originalValue;
    }
    
    return itemText;
}

// ===============================================
// メイン拡張機能
// ===============================================
const previewManager = new MediaPreviewManager();

// 設定項目の定義
const enableSetting = {
    name: "Enable Media Preview",
    id: _name("enable"),
    type: "boolean",
    defaultValue: true,
    onChange: (value) => {
        previewManager.setEnabled(value);
        if (!value) {
            previewManager.hidePreview();
        }
    },
};

const heightSetting = {
    name: "Preview Height",
    id: _name("height"),
    type: "slider",
    defaultValue: 200,
    attrs: { min: 80, max: 400, step: 20 },
    onChange: (value) => {
        previewManager.setPreviewHeight(value);
    },
};

// 動画設定
const videoVolumeSetting = {
    name: "Video Volume",
    id: _name("video_volume"),
    type: "slider",
    defaultValue: 0.5,
    attrs: { min: 0, max: 1, step: 0.1 },
    onChange: (value) => {
        previewManager.setVideoVolume(value);
    },
};

const videoAutoplaySetting = {
    name: "Video Autoplay",
    id: _name("video_autoplay"),
    type: "boolean",
    defaultValue: false,
    onChange: (value) => {
        previewManager.setVideoAutoplay(value);
    },
};

const videoLoopSetting = {
    name: "Video Loop",
    id: _name("video_loop"),
    type: "boolean",
    defaultValue: false,
    onChange: (value) => {
        previewManager.setVideoLoop(value);
    },
};

// 音声設定
const audioVolumeSetting = {
    name: "Audio Volume",
    id: _name("audio_volume"),
    type: "slider",
    defaultValue: 0.5,
    attrs: { min: 0, max: 1, step: 0.1 },
    onChange: (value) => {
        previewManager.setAudioVolume(value);
    },
};

const audioAutoplaySetting = {
    name: "Audio Autoplay",
    id: _name("audio_autoplay"),
    type: "boolean",
    defaultValue: false,
    onChange: (value) => {
        previewManager.setAudioAutoplay(value);
    },
};

const audioLoopSetting = {
    name: "Audio Loop",
    id: _name("audio_loop"),
    type: "boolean",
    defaultValue: false,
    onChange: (value) => {
        previewManager.setAudioLoop(value);
    },
};

// コンテキストメニューのフック
function hookContextMenu() {
    // LiteGraph.ContextMenu対応
    const addItem = LiteGraph.ContextMenu.prototype.addItem;
    LiteGraph.ContextMenu.prototype.addItem = async function(name, value, options) {
        const element = addItem?.apply(this, arguments);
        
        if (element && previewManager.enabled) {
            const itemPath = getItemPath(value);
            if (itemPath) {
                let previewData = null;
                
                // マウス入力時の処理
                LiteGraph.pointerListenerAdd(element, "enter", async (e) => {
                    try {
                        if (!previewData) {
                            const apiRes = await api_post("mediaPath", { path: itemPath });
                            if (apiRes.token && apiRes.category) {
                                previewData = apiRes;
                            } else {
                                // メディアがない場合は明示的にfalseを設定
                                previewData = false;
                            }
                        }
                        
                        if (previewData && previewData.token) {
                            // メディアがある場合はプレビュー表示
                            await previewManager.showPreview(
                                element, 
                                previewData.token, 
                                previewData.category
                            );
                        } else {
                            // メディアがない場合はプレビューを非表示
                            previewManager.hidePreview();
                        }
                    } catch (error) {
                        console.warn("Preview error:", error);
                        // エラー時もプレビューを非表示
                        previewManager.hidePreview();
                    }
                });
                
                // マウス離脱時の処理（メディア停止のみ、要素は残す）
                LiteGraph.pointerListenerAdd(element, "leave", (e) => {
                    // メディアを持つアイテムの場合のみ停止（要素は残す）
                    if (previewData && previewData.token) {
                        previewManager.stopMedia();
                    }
                    // メディアを持たないアイテムの場合は何もしない
                    // （プレビューが非表示になっているか、他のアイテムのプレビューが表示中）
                });
            }
        }
        
        return element;
    };
    
    // コンテキストメニューを閉じる時の処理
    const closeMenu = LiteGraph.ContextMenu.prototype.close;
    LiteGraph.ContextMenu.prototype.close = function() {
        previewManager.hidePreview();
        return closeMenu?.apply(this, arguments);
    };
    
    // 全てのコンテキストメニューを閉じる時の処理
    const originalCloseAll = LiteGraph.closeAllContextMenus;
    LiteGraph.closeAllContextMenus = function() {
        previewManager.hidePreview();
        return originalCloseAll?.apply(this, arguments);
    };
}

// ===============================================
// 拡張機能の登録
// ===============================================
const previewModelExtension = {
    name: _name("PreviewModel"),
    
    init: async function(app) {
        if (typeof LiteGraph !== "undefined") {
            hookContextMenu();
        }
    },
    
    settings: [
        // 基本設定
        enableSetting,
        heightSetting,
        // 動画設定
        videoVolumeSetting,
        videoAutoplaySetting,
        videoLoopSetting,
        // 音声設定
        audioVolumeSetting,
        audioAutoplaySetting, 
        audioLoopSetting
    ].slice().reverse(),
    
    setup: async function(app) {
        // 設定値の取得
        const enableValue = app.ui.settings.getSettingValue(enableSetting.id, enableSetting.defaultValue);
        const heightValue = app.ui.settings.getSettingValue(heightSetting.id, heightSetting.defaultValue);
        const videoVolumeValue = app.ui.settings.getSettingValue(videoVolumeSetting.id, videoVolumeSetting.defaultValue);
        const videoAutoplayValue = app.ui.settings.getSettingValue(videoAutoplaySetting.id, videoAutoplaySetting.defaultValue);
        const videoLoopValue = app.ui.settings.getSettingValue(videoLoopSetting.id, videoLoopSetting.defaultValue);
        const audioVolumeValue = app.ui.settings.getSettingValue(audioVolumeSetting.id, audioVolumeSetting.defaultValue);
        const audioAutoplayValue = app.ui.settings.getSettingValue(audioAutoplaySetting.id, audioAutoplaySetting.defaultValue);
        const audioLoopValue = app.ui.settings.getSettingValue(audioLoopSetting.id, audioLoopSetting.defaultValue);
        
        // 個別設定メソッドで反映
        previewManager.setEnabled(enableValue);
        previewManager.setPreviewHeight(heightValue);
        previewManager.setVideoVolume(videoVolumeValue);
        previewManager.setVideoAutoplay(videoAutoplayValue);
        previewManager.setVideoLoop(videoLoopValue);
        previewManager.setAudioVolume(audioVolumeValue);
        previewManager.setAudioAutoplay(audioAutoplayValue);
        previewManager.setAudioLoop(audioLoopValue);
    },
    
    beforeUnload: function() {
        previewManager.cleanup();
    }
};

app.registerExtension(previewModelExtension);