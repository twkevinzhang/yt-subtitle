# lyric-align-ts 整合驗收

正式依賴固定 registry 發布的 `lyric-align-ts@1.0.2`（Whisper C++／WASM，CPU，取代舊的 `@twkevinzhang/lyric-align-ts@0.1.1` WebGPU 版）。library 要求 SharedArrayBuffer，故 manifest 宣告 `cross_origin_opener_policy: same-origin` 與 `cross_origin_embedder_policy: require-corp`。產品無時間碼全流程仍缺整首音訊提供者。

`package.json`／`package-lock.json` 固定 1.0.2 registry tarball 與 integrity，未寫入本機絕對路徑。`npm ci` 可重現安裝。建置從安裝套件的 `package.json` 解析根目錄，完整複製至 `dist/vendor/lyric-align-ts/`，保留 `dist/` 內的 Worker、`assets/` 的 `.wasm`／tokenizer 及授權文件。沒有手動發布 ZIP。

## 消費端路徑

`SubtitleCoordinator → AudioProvider.acquire → IndexedDB AudioHandle → offscreen host → createBinding → prepare → transcribe → align → dispose → 完整結果驗證 → 原子發布`。

原有完整時間碼直接驗證套用，零音訊／模型呼叫。缺少整首音訊時回 `AUDIO_UNAVAILABLE`。只接受 library 宣告的英文，`lyricsContext=false` 時不傳歌詞提示。原文與換行保留，未匹配不補時間、不發布部分結果。host 排隊，一次執行一個工作；取消透過 AbortSignal 終止 library Worker，最多等五秒後關閉 offscreen，正常完成／失敗也關閉 host 並刪除 PCM。排隊取消立即釋放自己的 PCM；背景重啟先終止舊 host、清除遺留 PCM，不自動重跑。

## 真實瀏覽器測試

2026-10-23，隔離 Chrome for Testing 156.0.8078.4 profile，實際載入 `dist/manifest.json`；使用本機 Amazing Grace，解碼為 130.2988125 秒／16kHz PCM 與 12 行原文，素材不提交，無 AI 搜尋請求。

```powershell
npm ci
node build.mjs --package
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE --cancel
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE --cancel-transcribing
```

- Extension 載入、offscreen 建立、ES module 入口、library Worker 與 IndexedDB PCM 傳遞成功；收到模型下載的真實 bytes 進度。
- 正式 registry 1.0.2 以 11 秒 jfk 樣本與 3 行歌詞 **PASS**：cues 同數同序同原文，0 ≤ start < end ≤ duration；不代表整首歌曲耗時、記憶體或演唱時間準確度已評估。
- 正式 registry 1.0.2 推論中取消 **PASS**：收到 `transcribing` 進度後取消，library 回 `ABORTED`。取消探針以 `detail === "transcribing"` 觸發；1.0.2 不再回報舊版的 `step=N`。
- 移除 manifest 的 COOP／COEP 後，library 回 `UNSUPPORTED_DEVICE`（需要 cross-origin isolation），故兩項宣告是必要條件。
- 安裝入口 SHA-256：`e57e560df206beee8b7d845a9bae54211113988fecc7e7f98d307e95428e4ccf`；63 項 unit/integration、型別檢查與 2 項打包檢查通過。
- host-client 排隊取消與 PCM 啟動清理有整合測試；真實 probe 直接連 offscreen port，因此未驗證實際跨 tab queue、五秒強制關閉、長時間背景 service worker 存活／節流、推論中 GPU 釋放或演唱時間準確度。
- 報告：`test-results/library-host/report.json`、`cancel-transcribing.json`（本機忽略），包含進度、耗時與安裝入口 SHA-256。requests 只涵蓋 Playwright 看見的頁面請求，不作全 Worker 網路稽核。腳本使用 finally 關閉隔離瀏覽器，未啟動 dev server。

## library 修正與交付邊界

library 為 Whisper C++／WASM，Worker 為 classic Worker，載入 `dist/worker.js` 與 `dist/assets/` 的 WASM。extension CSP 保持 `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`：

1. 1.0.2 經 npm publish 公開發布，本專案正式從 registry 安裝，沒有本地套件覆蓋或 bundle 私有改寫。
2. loader 核對 contractVersion=1 與 libraryVersion=1.0.2；lockfile 固定來源與完整性。
3. 未驗證：整首歌曲的耗時與記憶體、跨 tab、背景 service worker 節流，以及 Chrome for Testing 以外的正式 Chrome。

`AudioProvider` 尚無獨立 YouTube 整首音訊下載來源；此測試使用本機音檔，不能當作產品 YouTube 端到端通過。不恢復隱藏播放器擷取，也不暫停或 seek 使用者影片。
