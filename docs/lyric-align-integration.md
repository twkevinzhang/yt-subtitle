# lyric-align-ts 整合驗收

本專案透過 `npm install --save-exact @twkevinzhang/lyric-align-ts@0.1.0` 安裝正式 npm 套件，未修改 `lyric-align-ts` 專案或套件內容。無時間碼全流程**尚未通過**。

`package.json` 固定版本，`package-lock.json` 固定 registry tarball 與 SHA-512 integrity；使用 `npm ci` 可重現安裝。建置從安裝套件的 `package.json` 解析根目錄，完整複製至 `dist/vendor/lyric-align-ts/`，保留 Worker 相對路徑及 LICENSE、THIRD_PARTY_NOTICES.md、licenses/。本專案不再保存手動發布 ZIP，也不依賴另一專案的 dist 目錄。

## 消費端路徑

`SubtitleCoordinator → AudioProvider.acquire → IndexedDB AudioHandle → offscreen host → createBinding → prepare → transcribe → align → dispose → 完整結果驗證 → 原子發布`。

原有完整時間碼直接驗證套用，零音訊／模型呼叫。缺少整首音訊時回 `AUDIO_UNAVAILABLE`。只接受 library 宣告的英文，`lyricsContext=false` 時不傳歌詞提示。原文與換行保留，未匹配不補時間、不發布部分結果。host 排隊，一次執行一個工作；取消透過 AbortSignal 終止 library Worker，最多等五秒後關閉 offscreen，正常完成／失敗也關閉 host 並刪除 PCM。排隊取消立即釋放自己的 PCM；背景重啟先終止舊 host、清除遺留 PCM，不自動重跑。

## 真實瀏覽器測試

2026-10-23，隔離 Chrome for Testing 156.0.8078.4 profile，實際載入 `dist/manifest.json`；使用本機 Amazing Grace 130.29875 秒音檔與 12 行原文，素材不提交，無 AI 搜尋請求。

```powershell
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE --cancel
```

- Extension 載入、offscreen 建立、ES module 入口、library Worker 與 IndexedDB PCM 傳遞成功；收到模型下載的真實 bytes 進度。
- 全曲測試 **FAIL**，`prepare()` 拒絕 `MODEL_LOAD_FAILED`：`no available backend found. ERR: [webgpu] TypeError: Failed to fetch dynamically imported module: blob:chrome-extension://…`。沒有進入 transcribe／align，沒有產生或發布字幕。
- 真實取消 **PASS**：第一個模型準備事件後取消，library 回 `ABORTED`。這驗證準備階段取消，並非推論中取消。
- host-client 排隊取消與 PCM 啟動清理有整合測試；真實 probe 直接連 offscreen port，因此未驗證實際跨 tab queue、五秒強制關閉、長時間背景 service worker 存活／節流、推論中 GPU 釋放或演唱時間準確度。
- 報告：`test-results/library-host/report.json`、`cancel.json`（本機忽略）。腳本使用 finally 關閉隔離瀏覽器，未啟動 dev server。

程式碼核對：發布物內 Transformers.js 的 WASM cache 會讀取 runtime factory，建立 JavaScript Blob，再動態 import。Chrome MV3 extension 的 script CSP 不允許這種載入；`wasm-unsafe-eval` 只允許 WASM 編譯，不能使任意 JavaScript Blob 合法。依據：[Chrome extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。

## 需要 library 配合的交付條件

不改變既有辨識／對齊 API 與演算法，但發布物必須能在 MV3 的 `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'` 下執行：

1. 提供本地靜態 runtime `.mjs`／`.wasm` 資產及穩定相對路徑；不依賴遠端可執行 JavaScript、JS Blob 或 data module。
2. library 自行配置 Transformers／ONNX runtime，以避免 WASM cache 的 JS Blob 轉換。可由正式 extension build preset 或明確資產配置介面完成；由 library 專案決定，consumer 不改寫其私有 bundle。
3. 交付新版本與校驗值，重新執行本專案真實 extension 全曲、推論中取消、dispose／重試測試。不能拿一般網頁的 12/12 結果替代。

另外，`AudioProvider` 尚無獨立 YouTube 整首音訊下載來源。它與 runtime 相容性是兩個獨立阻塞；不恢復隱藏播放器擷取，也不暫停或 seek 使用者影片。
