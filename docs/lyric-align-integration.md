# lyric-align-ts 整合驗收

正式依賴固定公開 `@twkevinzhang/lyric-align-ts@0.1.0`。使用者已授權修正 library 的 MV3 runtime；目前 node_modules 暫時安裝該 repo 的本地 tarball，真實 extension 全曲與推論中取消通過。修正**未發布 npm**；產品無時間碼全流程仍缺整首音訊提供者。

`package.json`／`package-lock.json` 維持 registry 版本與 integrity，未寫入本機絕對路徑。`npm ci` 會恢復公開版本，也會恢復該版的 Blob 問題。建置從安裝套件的 `package.json` 解析根目錄，完整複製至 `dist/vendor/lyric-align-ts/`，保留 Worker、靜態 runtime `.mjs`／`.wasm` 及授權文件。沒有手動發布 ZIP。

## 消費端路徑

`SubtitleCoordinator → AudioProvider.acquire → IndexedDB AudioHandle → offscreen host → createBinding → prepare → transcribe → align → dispose → 完整結果驗證 → 原子發布`。

原有完整時間碼直接驗證套用，零音訊／模型呼叫。缺少整首音訊時回 `AUDIO_UNAVAILABLE`。只接受 library 宣告的英文，`lyricsContext=false` 時不傳歌詞提示。原文與換行保留，未匹配不補時間、不發布部分結果。host 排隊，一次執行一個工作；取消透過 AbortSignal 終止 library Worker，最多等五秒後關閉 offscreen，正常完成／失敗也關閉 host 並刪除 PCM。排隊取消立即釋放自己的 PCM；背景重啟先終止舊 host、清除遺留 PCM，不自動重跑。

## 真實瀏覽器測試

2026-10-23，隔離 Chrome for Testing 156.0.8078.4 profile，實際載入 `dist/manifest.json`；使用本機 Amazing Grace，解碼為 130.2988125 秒／16kHz PCM 與 12 行原文，素材不提交，無 AI 搜尋請求。

```powershell
npm install --no-save --package-lock=false ../lyric-align-ts/spike/dist/twkevinzhang-lyric-align-ts-0.1.0.tgz
node build.mjs --package
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE --cancel
node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE --cancel-transcribing
```

- Extension 載入、offscreen 建立、ES module 入口、library Worker 與 IndexedDB PCM 傳遞成功；收到模型下載的真實 bytes 進度。
- 公開 npm 0.1.0 可重現 `prepare()` 拒絕 `MODEL_LOAD_FAILED: Failed to fetch dynamically imported module: blob:chrome-extension://…`。
- 本地修正包全曲 **PASS**：12/12 cues，同數同序同原文，0 ≤ start < end ≤ duration。runner 在傳回結果前已 await dispose；不代表演唱時間精準度已評估。
- 本地修正包推論中取消 **PASS**：收到實際 `seek … step=0` 解碼進度後取消，library 回 `ABORTED`。準備階段取消也有獨立 probe。
- host-client 排隊取消與 PCM 啟動清理有整合測試；真實 probe 直接連 offscreen port，因此未驗證實際跨 tab queue、五秒強制關閉、長時間背景 service worker 存活／節流、推論中 GPU 釋放或演唱時間準確度。
- 報告：`test-results/library-host/report.json`、`cancel-transcribing.json`（本機忽略），包含進度、耗時與安裝入口 SHA-256。requests 只涵蓋 Playwright 看見的頁面請求，不作全 Worker 網路稽核。腳本使用 finally 關閉隔離瀏覽器，未啟動 dev server。

程式碼核對：發布物內 Transformers.js 的 WASM cache 會讀取 runtime factory，建立 JavaScript Blob，再動態 import。Chrome MV3 extension 的 script CSP 不允許這種載入；`wasm-unsafe-eval` 只允許 WASM 編譯，不能使任意 JavaScript Blob 合法。依據：[Chrome extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。

## library 修正與交付邊界

library 原始碼已設定套件內靜態 factory／WASM、關閉 JS Blob cache，保留模型快取與上游對舊 Safari standard runtime 的選擇。辨識／對齊 API 與演算法未改動，extension CSP 保持 `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`：

1. `npm pack` 產生本地候選包，不發布 registry；消費端用 --no-save／--package-lock=false 安裝，無 bundle 私有改寫。
2. 公開版本仍不包含修正。未來正式發布必須升版並再次固定 dependency／lockfile；本輪沒有執行該動作。
3. Safari 選擇分支只有回歸單測，未實測 Safari；WASM 全曲、跨 tab、背景節流與 GPU 資源量測仍待驗證。

`AudioProvider` 尚無獨立 YouTube 整首音訊下載來源；此測試使用本機音檔，不能當作產品 YouTube 端到端通過。不恢復隱藏播放器擷取，也不暫停或 seek 使用者影片。
