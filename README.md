# AI 歌詞字幕

Chrome MV3 擴充功能，在 YouTube 影片旁提供字幕搜尋與處理狀態面板。使用者先設定自己的 AI 服務、來源網站，並在設定頁允許影片載入時自動搜尋；會傳送影片資訊與實際留言，並使用模型額度。

## 現在可用

- 影片 context 建立後自動啟動設定來源、YouTube 留言、全網搜尋三路搜尋，面板開關不重送。
- 窄面板顯示來源品牌、搜尋結果、五階段進度、唯讀歌詞預覽，標題列保留「重新載入」「設定」「×」。
- 具有完整有效時間碼的 SRT 原文驗證後一次套用；處理不暫停、播放或跳轉影片。
- 貼入原文或 SRT；失敗時保留原文與先前成功字幕。每一路搜尋可獨立重試。
- 進度節點支援滑鼠／鍵盤提示、Esc 關閉及螢幕閱讀器名稱。

## 取得方式與返回流程

面板先選擇「AI 取得字幕」或「貼入字幕」，兩個來源頁互斥顯示。「上一步」從來源頁返回方式選擇；從處理／結果頁返回原來源，保留輸入與選擇。處理中返回會取消本次處理，已完成字幕維持顯示。切入貼入頁取消尚未完成的 AI 搜尋，返回 AI 頁不自動重送，需按來源重試。貼入本身不需要 AI 服務設定。

## 整合邊界與限制

`src/subtitle/library-contract.ts` 定義 TS 契約，以 Python API 的辨識／對齊分工為基準：`prepare → transcribe(audio) → align(segments, lyrics) → dispose`。以 npm 安裝並固定 `@twkevinzhang/lyric-align-ts@0.1.0`，建置從 node_modules 複製套件與 Worker 資產供 offscreen host 載入；不保存手動發布 ZIP。但真實 MV3 測試在 runtime 的動態 JS Blob 載入失敗；獨立整首音訊下載來源也尚未接入。無時間碼全流程尚未可用。沒有修改另一個 library 專案。

所有模型、辨識、歌詞定位及 Worker 管理由 library 負責。本專案只包裝音訊 handle、排隊、進度、取消、結果驗證與發布。已驗證真實 offscreen 模型準備進度與取消，尚未通過 extension 全曲推論。具體證據、重跑命令及 library 配合條件見 [整合驗收](docs/lyric-align-integration.md)。

未匹配或不合法時間不插補、不發布部分字幕；文字相似度不是時間準確率。SRT 必須有完整起訖；只有起點的 LRC 不推估結束，需更換完整時間碼字幕或原文來源。原文與換行保留，辨識文字不能取代歌詞。

先前的校時模式、人工時間編輯、聲學對齊演算法、模型與播放器擷取入口均已移除。舊工作資料不會被自動當作新引擎成功結果；新的工作使用獨立 version 2 儲存快照，背景重啟不自動重發收費搜尋。既有設定自動搜尋同意預設關閉，需使用者明確開啟。

## 建置與驗證

```sh
npm ci
npm run typecheck
npx vitest run
npm test
npm run package
```

建置不下載語音模型。`dist/` 可在 Chrome 擴充功能開發者模式載入；ZIP 位於 `artifacts/ai-lyrics-extension.zip`。

`tests/e2e/dashboard.html` 是隔離的實際 React 面板測試頁，使用測試資料與本地協調器，不會送出 AI 請求；不包含在擴充功能發布物。啟動 Vite 後可用它驗證來源選擇、完整時間碼套用與 library 不可用狀態。這不等於真實 YouTube／AI 服務的端到端驗收。

架構設計：`docs/superpowers/specs/2026-10-22-subtitle-architecture-design.md`。實作計畫與尚待 library 配合的關卡：`docs/superpowers/plans/2026-10-22-subtitle-integration.md`。
