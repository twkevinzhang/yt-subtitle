# 字幕工作台架構與 lyric-align-ts 整合設計

狀態：完整設計及實作計畫已核准；library、offscreen 與 IndexedDB 已接入，獨立音訊來源尚缺。使用者已授權修正 lyric-align-ts 的 MV3 runtime，相容修正以本地 tarball 驗證，不發布 npm。真實全曲推論與推論中取消已通過，產品端到端流程仍待音訊提供者。

## 目的與範圍

影片正常播放時完成字幕準備。移除「先緩衝再播放」「播放中背景校時」及人工時間編輯，全專案固定完整結果就緒後才使用。字幕頁改為處理狀態 dashboard。

本專案保存 TypeScript 消費契約；library 已提供 contract v1 的正式 session API。使用者允許在 C:/Projects/lyric-align-ts 修正 runtime 資產載入，但對齊與辨識邏輯仍全部留在該 library。附件的 Python API 是分工基準。模型目前僅英文 small.en／WebGPU，不能推定多語言能力。

## 已確認的產品政策

- 首次取得有效影片 context 時即啟動設定來源、YouTube 留言、全網搜尋三路 request，不等使用者開面板。
- 面板開啟即讀現有搜尋快照，尚未完成顯示 loading；顯示已取得候選與各路狀態，不必等其他路全部結束才可選。這是本設計的協調預設。
- 搜尋 response 含歌曲語言／語音模型語言提示。語言提示不是承諾支援；實際支援由 library 判定，不因 AI 提示下載另一模型。
- 選用完整且合法的時間碼字幕時沿用原時間，不下載音訊、不呼叫辨識與對齊。
- 無時間碼才取得整首音訊，依序呼叫 library.transcribe、library.align，整首結果驗證成功後原子套用。
- 保留原文與換行；ASR 文字只為辨識證據，永不取代所選歌詞。
- 有任一必須定位的歌詞行未匹配：不插補、不套用部分結果，顯示未匹配句數與重試／更換來源。
- 本專案不實作文字正規化配對、時間插補、音訊辨識、模型選擇、切段、Worker 池或聲學演算法。先前 tiny／WASM／60 秒並行方案已取消。
- 所有流程不呼叫播放器 pause、play 或 seek；使用者自行操作影片不改變全曲任務。

## 元件與執行邊界

```text
影片 context / SPA 導航
  → 背景 SearchCoordinator → 三路 AI 搜尋 → 影片工作快照
  → 側欄：來源選擇、五階段狀態、唯讀預覽
       → SubtitleJobCoordinator
          ├─ 完整合法既有時間碼 → ResultValidator → Overlay
          └─ 完整 AudioProvider → LibraryHost
                                  → prepare
                                  → transcribe(audio, lyrics context)
                                  → align(segments, lyrics)
                                  → ResultValidator → Overlay
```

- content script 管影片 context、側欄與 overlay，不載入模型。
- extension background service worker 管搜尋、工作識別與快照，不持有長時間推論。
- extension offscreen document 作 LibraryHost，讓關閉面板不終止任務。library 自行管理模型／推論 Worker；本專案僅提供程序與訊息邊界。
- AudioProvider 負責獨立取得完整音訊與解碼為單聲道 16 kHz PCM。可保留通用下載／解碼程式，但不得依賴原生播放器緩衝、seek 或播放狀態。現有音訊來源須查證符合此條件，否則明確失敗，不退回擷取播放流程。
- 如需既有 PO token／音訊取得服務，只可沿用已授權服務，不新增上傳音檔的辨識服務。音訊、歌詞推論留在瀏覽器。
- transport 不直接透過 chrome.runtime JSON message 傳 Float32Array；採短期 IndexedDB 音訊記錄與 opaque handle，由 offscreen 讀取。library 內部 Worker transfer 是 library 責任。

## 搜尋與資料來源

SearchKey = videoId + settingsRevision。每個 frame／tab 的播放綁定獨立，背景協調相同搜尋鍵的重複觸發。先確認設定及既有資料傳輸同意；未完成設定／同意時顯示需設定，不暗中繞過授權。

三路成功／無結果／失敗／取消獨立記錄；一路失敗不清空其他結果。手動重試只重送指定路，重新載入則取消該影片舊工作並建立新 generation。搜尋結果須驗證 schema，網頁、留言和 AI 文字皆視為資料。

候選包含 candidateId、route、sourceName、sourceUrl/domain、rawText、languageHint、時間碼與 time provenance。模型名稱欄位僅供診斷，不用作任意遠端載入指令。設定來源依使用者啟用網站逐一記錄來源，不把所有網站冒充 LRCLIB。Google 是全網搜尋路徑品牌，候選仍顯示實際原始網站。

## 時間碼、文字與結果驗證

來源時間碼必須覆蓋所有非空白歌詞行，有限數值、0 ≤ start < end ≤ duration，行起點不得倒退；允許真實重疊。不排序修復、不夾限、不推估缺漏。混合／殘缺／非法時間碼來源顯示格式問題，不自動丟棄已有時間碼並重對齊；使用者改選來源。這是為遵守「有時間碼就尊重」採用的設計預設。

rawText 原樣保存，另外建立 libraryLyrics 與 sourceLineIndexes；僅純空白行不送對齊，所有非空白行包含括號內容原樣傳入，不自行判定為譯文或刪除。空白行保留在預覽／原文，不產生無文字 cue。行索引區分重複副歌。

align 回傳必須與輸入歌詞同數、同順序、line 逐字相等；不相等為 CONTRACT_VIOLATION，不自動改字或猜對應。matched=false 或任一 null／無效／超界時間均算未匹配；score 是文字相似度，不當作秒數準確率。UI 顯示未匹配行數，以行索引去重；其他結構契約錯誤獨立報錯。

所有非空白行通過才將秒數一次轉為毫秒並檢查捨入後 start < end，再以原文建立字幕／SRT。不呼叫 interpolateGaps；不以鄰句時間延長。這裡驗證結構合法性，不宣稱模型時間與真實演唱已經準確。

更換來源處理期間保留先前已成功套用的完整字幕並標明「目前顯示先前字幕」；首次任務則沒有新字幕。新結果成功後一次替換。失敗不覆蓋既有字幕。這是避免播放顯示被未完成結果污染的設計預設。

## TS library 契約

詳見 `lyric-align-contract.ts`。Python 核心概念保留：Word、Segment、AlignedLine、transcribe、align；參數改用 TS options object。不在 browser contract 暴露本機檔案路徑、CUDA、faster-whisper 或 Demucs。

額外 browser 整合需求：prepare() 明確回報模型下載／初始化、AbortSignal、onProgress、dispose。它們是待 library 提供的需求；本專案不得偽造進度或自行補上演算法。capabilities 是 library 隨 binding 提供的靜態描述，不是宣稱 Python 存在 capabilities()。

prepare / transcribe / align 同一 session 依序執行，不並行；transcribe 的 lyricsContext 可讓 library 使用歌詞提示，處理方法屬 library。align 保留 pairing、threshold、window、karaoke 概念；只有 capability 宣告的選項可傳入。不直接沿用 Python 的日文／medium／CPU 預設。沒有指定時由 library 既定配置決定；不在 UI 新增模型選擇。

chars 不猜測 Python list[dict] 的未定欄位，先標為 opaque 且本版不使用逐字資料；karaoke=false。字幕匯出由本專案既有格式層以完整驗證結果處理，不要求 library 實現全部 Python CLI／輸出 API。

缺少 binding 時顯示 LIBRARY_UNAVAILABLE；不假造 import path／npm 套件名，不退回舊對齊引擎。有時間碼路徑仍可使用。完整無時間碼流程的驗收依賴後續 library 實現本契約，mock 只能驗收協調流程。

## 任務生命週期與狀態

JobKey = tabId + videoId + sourceFingerprint + generation，所有訊息帶 jobKey、遞增 sequence。來源指紋含原文、原時間碼與語言；舊 generation／亂序事件一律丟棄。AbortSignal 僅留本地，跨 extension 訊息傳 cancel(jobKey)，offscreen 再 abort。

Job phase：searching → selecting → acquiring-audio → preparing-model → transcribing → aligning → validating → applying → complete；終態另有 incomplete、failed、cancelled。選擇完成合法時間碼時直接 validating → applying。

UI 五步映射：尋找字幕、取得音訊、準備語音模型、對齊歌詞（transcribing + aligning + validating）、套用字幕。selecting 保持等待選擇，不冒充下載中；既有時間碼將音訊／模型／對齊標為「不需要」。單一 reducer 同步階段標題、step、處理狀態與按鈕。進度僅依 library 同 phase 的實際 loaded/total，無 total 不提供百分比，沒有總體猜測百分比。

同一 host 同時最多一個音訊／推論工作（設計預設），其他 tab 任務排隊且可取消，避免多模型耗盡 GPU；跨 tab 不共享不明所有權的 session。關閉面板繼續；離開影片、關閉 tab、重新載入或更換來源取消；重新開啟面板讀快照，不重送搜尋與對齊。

取消後立即使 generation 失效。host 要求 library abort、等待退出再 dispose；逾寬限時間終止 offscreen host 並標示取消，不沿用該 session。逾時數值留給實作者依裝置實測決定，不能復用當前舊模型的 30 秒推論 timeout。新任務只能在舊 host 釋放或終止後開始。

瀏覽器重新啟動不承諾推論 checkpoint 恢復。保存搜尋、選擇、完整結果與中斷原因；音訊短期記錄於完成／取消／失敗後清除，啟動時清除失主記錄。重試沿用選擇與搜尋，不重複收費搜尋；重新取得必要音訊並重跑全曲。未匹配結果只保存診斷，不發布部分字幕。

## UI 核准方向

面板先進入取得方式選擇，AI 與貼入來源頁互斥。「上一步」在來源頁回方式選擇，在處理／結果頁回原來源；處理中返回先取消本次處理，保留選擇、貼文及先前完整字幕。進入貼入頁取消未完成搜尋，返回 AI 不自動重送，由使用者明確重試。貼入不依賴 AI 設定。

約 440px 寬側面板，高度沿用現有影片 placement，內部捲動；不把示意 640px 寫死為產品高度。深色環境、單欄、五步 icon 軌道。右上固定「重新載入」「設定」「×」。影片持續播放提示位於內容區。

設定來源徽章／候選使用實際網站 logo，留言路徑用 YouTube logo，全網搜尋路徑用 Google logo；保留結果文字。圖示失敗退回網站名稱；避免額外第三方 favicon 聚合服務。網站來源 logo 來源須符合 extension host permission；不可為顯示 logo 取得任意廣域權限。

節點可 Tab 聚焦，hover／focus 顯示階段＋狀態 tooltip，aria-describedby、aria-current、role=tooltip；Esc 關閉。提示需可停留、不中途消失，游標可移到 tooltip；實作不用草圖的 pointer-events:none。重要狀態不用顏色單獨傳達。狀態 live region 去重，避免模型細碎事件反覆朗讀。

字幕選項顯示實際來源、語言與時間碼策略，選擇後下方唯讀預覽，無「右側預覽」文案。未匹配面板顯示 N 句未匹配／總句數、可展開行清單、重試與更換來源。錯誤顯示使用者可操作資訊；技術詳細資料收合。

最新草圖：`.superpowers/brainstorm/579-1792662625/content/candidate-logos.html`。草圖的固定歌曲／來源／結果數只是示意，不得進產品資料流。

## 舊實作移除與儲存遷移

目前消費端已移除舊聲學對齊、模型打包、三模式與 Editor 路徑；設定改為自動搜尋的明確同意。下面是移除／遷移的驗收範圍。

- 刪除舊 alignment-policy、scheduler、lyric-locator、missing-location、acoustic-evidence、token-onset、Japanese readings、model-session／model-worker／assets 等引擎專屬實作與無用依賴／vendor／build packaging。實作者按 import graph 決定檔案邊界，不盲刪仍共用的通用格式或音訊解碼。
- 移除 region-request 等舊 AI 粗定位，以及所有基於播放進度／buffer 的校時路徑、playback-coordinator 中的校時控制。保留與新設計無關的 overlay／位置／既有顯示設定。
- 移除 Editor、時間鎖、人工修改、模式選單、AlignmentMode 與相關 schema／訊息／測試／文案。不保留舊模式分支作 fallback。
- 替換 acoustic-jobs／host／offscreen 的協調用途；保留的是程序架構，不是舊引擎。
- 升級 workspace／settings schema，移除 alignmentMode，丟棄舊未完成 checkpoint、部分字幕與來源不明的校時結果。可保留具有完整原始時間碼與可驗證來源的字幕；其他舊結果保留原文為未處理來源，不能當新引擎成功結果。
- 實作時同步更新 README 與現行架構文件，移除失真說明；不新增歷史方案文件。

## 驗收

1. 影片載入即三路搜尋，每鍵不重複；未設定／未同意時不發送。關面板再開不重送。
2. 完整來源時間碼零模型呼叫，原時間與文字維持；殘缺時間碼不被靜默覆寫。
3. 無時間碼呼叫 prepare → transcribe → align，音訊全曲且不操作播放器。
4. 重複歌詞、空白行、原文換行保存；ASR 差異不改歌詞。
5. matched=false、null、倒序、超界、漏行、改字均不發布部分結果；未匹配計數準確。
6. 切影片、更換來源、重載、取消、跨 tab 佇列與晚回應不污染結果；關面板繼續。
7. 五步、標題、清單同步；來源品牌正確；440px 窄面板、長標題、鍵盤 tooltip／Esc／讀屏可用。
8. 舊設定遷移後無模式分支、人工編輯或漸進發布；依賴／vendor 不殘留舊引擎。
9. mock 驗證協調與異常；library 到位後以真實英文全曲驗證 WebGPU、資源釋放、原文保持及完整發布。未完成真實整合前不得宣稱整體流程可用。

正式 lockfile 固定公開 @twkevinzhang/lyric-align-ts@0.1.0，該版仍有 JS Blob 載入問題。本地 MV3 修正包以 npm --no-save 安裝，在實際 offscreen／Worker 通過全曲與取消測試，尚未發布 npm；npm ci 會還原公開版本。整首獨立音訊來源尚缺。完整證據見 [整合驗收](../../lyric-align-integration.md)。

可靠度分數：95%（本地修正包已通過真實 extension 全曲與推論中取消；公開 npm 尚未更新，產品全流程仍缺音訊來源）。升分方式：接入正式相容發布版及獨立整首音訊來源，再驗證跨 tab、背景節流／重啟與 GPU 釋放。不移入對齊演算法。
