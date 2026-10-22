# Subtitle Architecture Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將字幕準備改為自動搜尋、整首完成才套用，並以本專案定義的 TS 契約整合 lyric-align-ts。

**Architecture:** background 協調搜尋與任務，offscreen host 執行 library session，content 只負責窄面板與 overlay。來源時間碼與 library 結果共用嚴格驗證及原子發布。演算法、模型與推論 Worker 屬 library。

**Tech Stack:** 現有 React 19、TypeScript、Chrome MV3、Vite、Zod、IndexedDB、Vitest、Playwright；library 版本與 import path 待提供，禁止假造套件。

**Spec:** `docs/superpowers/specs/2026-10-22-subtitle-architecture-design.md`；契約 `docs/superpowers/specs/lyric-align-contract.ts`。

## Global Constraints

- 使用者已核准在目前 session 執行；不得修改 C:/Projects/lyric-align-ts。
- 固定完整結果就緒後才使用，保留原文與換行，未匹配不補時間、不發布部分字幕。
- 時間跨 library 邊界一律秒；字幕層一次轉毫秒。
- 不呼叫播放器 pause、play 或 seek；不以隱藏播放器擷取替代獨立整首音訊取得。
- 無時間碼完整流程須依賴真正實現契約的 library；mock 不代表模型整合成功。
- 禁止恢復 tiny／WASM／60 秒切段並行方案、舊對齊引擎 fallback 或人工校時。
- 右上固定「重新載入」「設定」「×」，約 440px 窄面板，高度沿用 placement。
- 執行前確認本地變更及 AGENTS；需隔離時使用 using-git-worktrees。提交前讀 make-git，只提交該任務檔案；部署不在範圍。

## Review Focus

1. 切影片／服務程序重啟後的晚回應不得污染新任務（Task 4、6）。
2. 重複副歌、空白行、Unicode 與毫秒捨入不可改字或產生非法 cue（Task 1）。
3. 來源混合時間碼、超界、缺尾時間不可靜默改成無時間碼重跑（Task 1）。
4. 音訊下載授權過期、截斷、取消與資源清理不得偷用播放器或遺留 PCM（Task 3、4）。
5. 多網站 logo 載入失敗、長標題與鍵盤 tooltip 不可讓窄面板失去辨識能力（Task 7）。

## 現況證據與先決關卡

- `build.mjs` 在 build 開始前讀舊 `src/acoustic/model-manifest.json` 並下載模型；因此規劃階段不執行 npm build/test。
- `src/acoustic/youtube-audio-source.ts` 建立 autoplay 隱藏 iframe，`youtube-stream.ts` 依 progressive capture；不能直接沿用作新 AudioProvider。
- `vitest.config.ts` 已定義 tests/unit 與 tests/integration，但本 checkout 未找到這些測試資料夾；計畫的新測試路徑需建立，不能聲稱舊測試存在。
- 真實 library 的發布物、固定版本、prepare/progress/abort/dispose、英文支援與 offscreen WebGPU 都必須交付後驗證；本計畫不修改對方以補齊。

**目前實作狀態**：原文／時間驗證、單一狀態、背景搜尋與 v2 快照、原子套用、窄面板與舊引擎移除已接線。library-runner 有隔離契約測試；正式 loader 回 null。尚未接入音訊提供者與 offscreen runtime，不啟動空殼推論程序。測試與檢查依目前 repository 命令執行，不能將下方待辦全視為已完成。`npx` 不在此環境 PATH，實作使用 `node node_modules/vitest/vitest.mjs` 等效命令。

**關卡 A（Task 3）**：證明可透過已授權來源獨立取得完整音訊；若不可行，保留明確 AUDIO_UNAVAILABLE 與已時間碼路徑，停止宣稱無時間碼可用，不改成錄製播放器。

**關卡 B（Task 9）**：收到真正符合契約的 library 才接線；未收到時完成 Task 1–8 的無 binding 狀態及 mock 驗收，Task 9 保持未完成。不得把 conditional integration 當成交付完成。

## 檔案與責任

新增 `src/subtitle/`：library-contract、types、source-input、result-validation、job-state、library-loader、library-runner、host-queue、audio-provider，各檔只管一項責任。

新增 `src/background/subtitle-jobs.ts` 管 jobKey／generation／sequence，新增 `src/background/subtitle-assets.ts` 管短期音訊記錄。既有 search-group 負責三路搜尋，workspaces 管持久快照。

保留 offscreen 程序位置 `src/acoustic/offscreen.ts` 但替換為新 host 接線；不無謂更名所有通用音訊工具。`Panel.tsx` 拆出 `SubtitleDashboard.tsx`、`ProgressSteps.tsx`、`SourceBadges.tsx`，移除 Editor 路徑。

共用型別沿用專案 convention；計畫下列介面是實作時需具體化的界線，不是現有 API。

## Task 1: 原文輸入與完整結果驗證

**Files:** Create `src/subtitle/{library-contract,types,source-input,result-validation}.ts`; tests `tests/unit/subtitle-result.test.ts`。

**Interfaces:** 從核准契約複製 library 型別；定義 `SelectedSource { rawText: string; languageHint?: string; timings?: readonly {sourceLineIndex:number;start:number;end:number}[] }`、`PreparedLyrics {rawText:string;lyrics:readonly string[];sourceLineIndexes:readonly number[]}`、`PlayableCue {sourceLineIndex:number;text:string;startMs:number;endMs:number}`。驗證回傳 `ResultValidation = {kind:'complete';cues:readonly PlayableCue[]} | {kind:'incomplete';lineIndexes:readonly number[]} | {kind:'invalid';code:string}`。

- [ ] 寫失敗測試：`prepareLyrics` 保存原始 CRLF／空白行、非空白行逐字保留；兩個相同副歌保持不同索引。
- [ ] 寫失敗測試：部分來源時間碼回 invalid，來源時間碼不改；matched=false/null/超界回 incomplete；漏行／改字回 invalid；0.0001–0.0002 秒捨入為同毫秒不得通過。
- [ ] 執行 `npx --no-install vitest run tests/unit/subtitle-result.test.ts`，確認因新模組尚不存在而失敗。
- [ ] 實作 `prepareLyrics(rawText:string):PreparedLyrics`、`validateSource(source:SelectedSource,durationSeconds:number):ResultValidation | {kind:'untimed';lyrics:PreparedLyrics}`、`validateAligned(lyrics:PreparedLyrics,result:readonly AlignedLine[],durationSeconds:number):ResultValidation`。只驗證與轉換，不實作對齊。
- [ ] 重跑同一命令，預期全 PASS，再 `npm run typecheck`。
- [ ] 依 make-git 提交此任務檔案，建議訊息 `feat: define subtitle library boundary and result validation`。

## Task 2: 單一任務狀態與 extension 訊息契約

**Files:** Create `src/subtitle/job-state.ts`; modify `src/shared/{types,schemas,workspace}.ts`; test `tests/unit/subtitle-state.test.ts`。

**Interfaces:** `JobKey {tabId:number;videoId:string;sourceFingerprint:string;generation:number}`；`JobPhase` 為 spec 全部 phase；`JobSnapshot {key:JobKey;sequence:number;phase:JobPhase;progress?:Progress;unmatchedLineIndexes:readonly number[];error?:{code:string;message:string}}`。`reduceJob(state:JobSnapshot,event:JobSnapshot):JobSnapshot`、`toDashboardSteps(state:JobSnapshot):readonly {id:string;status:'waiting'|'active'|'done'|'failed'|'skipped'}[]`。

- [ ] 寫失敗測試：舊 generation／不同 key／非遞增 sequence 不變更快照；prepare、transcribe、align、validating 五步映射同步；timed route 模型／音訊／對齊為 skipped；selecting 不標為下載中。
- [ ] 跑 `npx --no-install vitest run tests/unit/subtitle-state.test.ts`，預期缺模組失敗。
- [ ] 實作 reducer 與新 Zod 訊息：start(snapshot source)、cancel(key)、snapshot(key)；不得跨 runtime 傳 AbortSignal／Float32Array。message 的 source 使用 Task 1 SelectedSource。
- [ ] 同命令 PASS 與 typecheck；本步保留舊 consumer 相容至 Task 8，不新增舊模式分支。
- [ ] 依 make-git 提交，`feat: add generation-scoped subtitle job state`。

## Task 3: 完整音訊提供者與可行性關卡

**Files:** Create `src/subtitle/audio-provider.ts`, `src/background/subtitle-assets.ts`; inspect/reuse `src/background/{audio-uploads,po-token-client,po-token-authorization}.ts` 與通用解碼工具；test `tests/integration/subtitle-audio.test.ts`。

**Interfaces:** `AudioHandle {id:string;sampleRate:16000;sampleCount:number}`；`AudioProvider.acquire(videoId:string,durationSeconds:number,signal:AbortSignal):Promise<AudioHandle>`；asset store `read(id:string):Promise<AudioInput>`、`remove(id:string):Promise<void>`、`clearOrphans(activeIds:readonly string[]):Promise<void>`。

- [ ] 先寫測試：成功取得完整 PCM、截斷／授權失效明確錯誤、取消會清掉 asset；播放器 pause/play/seek spy 呼叫次數皆 0。
- [ ] 跑 `npx --no-install vitest run tests/integration/subtitle-audio.test.ts`，預期缺模組失敗。
- [ ] 唯讀追查現有服務是否提供合法可用的完整下載來源；記錄實測 HTTP／媒體完整性與授權，不臆造 endpoint。不新增外部部署或上傳音訊服務。
- [ ] 有可用來源才實作 acquire 與完整解碼；先以 metadata／sampleCount、finite samples 驗證，容量限制沿用現有保護並清楚報錯。不用播放器緩衝判完整性。
- [ ] 若無可用來源，acquire 回 `AUDIO_UNAVAILABLE`，將關卡 A 標未通過；保留 mock 測試，不聲稱下載成功。不能用 fake provider 作正式 binding。
- [ ] 測試 PASS，執行人工完整下載驗證並記結果；依 make-git 提交，`feat: isolate complete-audio acquisition and assets`。

## Task 4: Library runner 與 offscreen 生命週期

**Files:** Create `src/subtitle/{library-loader,library-runner,host-queue}.ts`, `src/background/subtitle-jobs.ts`; modify `src/background/{index,acoustic-host}.ts`, `src/acoustic/offscreen.ts`; tests `tests/integration/subtitle-runner.test.ts`。

**Interfaces:** `resolveLibrary():Promise<LyricAlignBinding|null>`（到 Task 9 前正式環境為 null）；`runUntimed(binding:LyricAlignBinding,audio:AudioInput,lyrics:PreparedLyrics,languageHint:string|undefined,context:OperationContext):Promise<ResultValidation>`；`enqueue(key:JobKey,work:(signal:AbortSignal)=>Promise<void>):Promise<void>`、`cancel(key:JobKey):Promise<void>`。

- [ ] fake binding 記錄呼叫，斷言 createSession → prepare → transcribe → align → dispose；align 收到正確 segments 與原文；無 binding 回 LIBRARY_UNAVAILABLE。
- [ ] 加取消、延遲回應、跨 tab 先進先出、abort 未回應的 host 終止、service worker 重啟 orphan 清理測試；asset 無論何種終態都刪除。
- [ ] 跑 `npx --no-install vitest run tests/integration/subtitle-runner.test.ts`，預期缺模組失敗。
- [ ] 實作 wrapper，不匯入 Transformers、不建模型 Worker；prepare 回報接 Task 2 狀態。只傳 capability 支援的 lyricsContext／options，未支援語言明確失敗。context callback 錯誤不得造成漏清理。
- [ ] 取消使 generation 立即失效；先 abort 等 operation 結束再 dispose，設定可注入 `cancelGraceMs` 供實測選值，超過時整個 offscreen host 終止且不重用 session；禁止同時第二個 active job。
- [ ] 測試 PASS、typecheck；依 make-git 提交，`feat: coordinate library jobs in offscreen host`。

## Task 5: 影片載入即三路搜尋與來源快照

**Files:** Modify `src/content/index.ts`, `src/background/{index,search-group,workspaces}.ts`, `src/shared/{schemas,workspace}.ts`; test `tests/integration/subtitle-search.test.ts`。

**Interfaces:** 新增 `ensureVideoSearch(input:{tabId:number;video:VideoContext;settingsRevision:number}):Promise<SearchGroupSnapshot>`；候選延伸 Task 1 SelectedSource + candidateId、route、sourceName、sourceDomain/sourceUrl。沿用 search-group 現有 snapshot，不新增第二套搜尋引擎。

- [ ] 測試首次 context 即發三路、重複掛載不重送、開關面板不重送、未同意或未設定零 request、一路失敗保留其他路結果、settingsRevision 變更新建搜尋鍵。
- [ ] 跑 `npx --no-install vitest run tests/integration/subtitle-search.test.ts`，預期新入口缺失而失敗。
- [ ] 將搜尋啟動移離 Panel 開啟事件；解析／驗證 languageHint，保存每個設定網站的真實來源；關閉面板不取消，影片離開取消未完成工作。
- [ ] 有候選即允許選擇；未完成路仍顯示 loading，不把來源結果交叉覆蓋；指定路重試只發該路。
- [ ] 測試 PASS、typecheck；依 make-git 提交，`feat: start subtitle discovery on video load`。

## Task 6: 完整字幕原子發布與重新載入

**Files:** Modify `src/content/overlay.ts`, `src/ui/use-subtitle-work.ts`, `src/background/{results,workspaces,subtitle-jobs}.ts`; test `tests/integration/subtitle-publish.test.ts`。

**Interfaces:** `publishComplete(key:JobKey,cues:readonly PlayableCue[]):Promise<void>`（校驗 active generation 後一次寫完整結果）；`reloadVideoWork(tabId:number,videoId:string):Promise<void>`（失效 generation、取消、清該影片工作並重啟搜尋）。

- [ ] 寫測試：timed route 不碰 AudioProvider／binding；未匹配 N 行不呼叫 publish；處理新來源期間仍顯示舊完整字幕；成功一次替換；影片切換後晚成功被拒絕。
- [ ] 跑 `npx --no-install vitest run tests/integration/subtitle-publish.test.ts`，預期失敗。
- [ ] 接 Task 1–5；incomplete 行索引去重並保存診斷，重試保留選擇不重送搜尋；重新載入維持現行清工作資料語意及既有必要確認流程，不改成網頁 reload。
- [ ] 發布前驗證身份與完整結果；原文為唯一字幕文字來源，不使用 ASR 文字組 cue。關閉面板僅隱藏 UI。
- [ ] 測試 PASS、typecheck；依 make-git 提交，`feat: publish only complete validated subtitles`。

## Task 7: 核准窄面板與無障礙互動

**Files:** Create `src/ui/{SubtitleDashboard,ProgressSteps,SourceBadges}.tsx`; modify `src/ui/{Panel,SearchGroups,LyricsPreview}.tsx`, `src/ui/styles.css`; tests `tests/integration/subtitle-dashboard.test.tsx`, `tests/e2e/subtitle-dashboard.spec.ts`。

**Interfaces:** `SubtitleDashboard({job:JobSnapshot,search:SearchGroupSnapshot|undefined,onRetry:()=>void,onChangeSource:()=>void})`；ProgressSteps 消費 Task 2 toDashboardSteps；SourceBadges 消費候選 provenance／路徑狀態。UI 不自行推估進度。

- [ ] 寫測試：三路 logo 對應、設定兩網站分開顯示、logo 失敗網站名稱 fallback、準備模型步驟與標題／清單同步、未匹配 N 句提供兩個操作；頂部三按鈕順序固定。
- [ ] 跑 `npx --no-install vitest run tests/integration/subtitle-dashboard.test.tsx`，預期缺新元件失敗。
- [ ] 依 `.superpowers/brainstorm/579-1792662625/content/candidate-logos.html` 核准視覺製作；草圖不存在時仍以 spec 為準。最後確認的 YouTube／Google／來源網站 logo 與標題列皆要包含，不複製示意資料。
- [ ] 搜尋 logo：使用已授權網站自己的資產，不新增廣域權限或 favicon 聚合服務；無可取 logo 顯示網站名。候選用實際來源品牌，Google 只代表搜尋路徑。
- [ ] Step 使用可聚焦節點＋可停留 tooltip，hover／focus 可見、Esc 關閉、aria-describedby/current；讀屏只公告階段變更。保留主要標題與操作文字，歌詞唯讀在下方。
- [ ] integration PASS 後以 Playwright 在 440px 面板與較小可用寬度測長標題／scroll／Tab／Esc／tooltip 游標移入；`npx --no-install playwright test tests/e2e/subtitle-dashboard.spec.ts` 預期 PASS。dev server 遵守既有保留選擇與生命週期規則。
- [ ] 截圖視覺驗收並提交，`feat: replace subtitle editor with progress dashboard`。

## Task 8: 舊模式、引擎、依賴與儲存遷移一次收斂

**Files:** Modify `src/background/settings.ts`, `src/shared/{types,schemas,workspace}.ts`, `src/options/Options.tsx`, `src/content/playback-coordinator.ts`, `build.mjs`, `build.test.mjs`, `package.json`, lockfile, `extension/manifest.json`, `README.md`; remove verified obsolete files in `src/acoustic/`, `src/lyrics/`, `src/ui/Editor.tsx` 等 spec 清單；tests `tests/unit/subtitle-migration.test.ts`。

**Interfaces:** `migrateSubtitleWorkspace(raw:unknown):VideoWorkspace` 與 `migrateSubtitleSettings(raw:unknown):SettingsRecord` 放入各自現有 storage 模組；新 schema 不包含 alignmentMode／人工時間／部分結果 checkpoint。

- [ ] 先寫測試：舊三種模式都轉成相同新語意，丟未完成 checkpoint／無來源結果，保留可驗證原時間碼及原文；reopen 不恢復舊引擎工作。
- [ ] 跑 `npx --no-install vitest run tests/unit/subtitle-migration.test.ts`，預期舊 schema 不符而失敗。
- [ ] 先產生 import graph 與 build entry 清單，列明 engine-only 和共用解碼檔案。刪舊模式及人工編輯、region-request 粗定位、聲學配對／模型資產／Worker；保留通用字幕格式、解碼及無關顯示功能。
- [ ] 移除 build 啟動時下載舊模型與其 vendor 包裝；重新決定 offscreen entry／CSP，正式無 library 時仍可 build。移除不再使用的 transformers／kuromoji；未取得 library 前不安裝猜測套件。
- [ ] 更新所有 consumer、schema、設定頁、storage version 與 README；只保留最新方案。正式 loader 無 binding 回明確不可用，絕無舊引擎 fallback。
- [ ] 測試 PASS；執行 `npm run typecheck`、`npx --no-install vitest run`、`npm test`、`npm run build`、`npm run package`；先確定新 build 不再下載舊模型。驗 ZIP／dist 不含舊 ONNX、worker 或模式文案。
- [ ] `rg -n 'buffer-before-play|complete-before-use|播放中背景校時|先緩衝再播放|whisper-base_timestamped' src build.mjs extension` 預期無執行路徑命中；遷移測試可以含舊字串。依 make-git 提交，`refactor: remove legacy alignment engine and migrate storage`。

## Task 9: 真實 library 接線與全流程發布驗收（外部依賴）

**Files:** Modify `src/subtitle/library-loader.ts`, `package.json`, lockfile, `build.mjs`, `extension/manifest.json`（僅必要且經核對項目）；create `tests/integration/library-binding.test.ts`, `tests/e2e/subtitle-library.spec.ts`; update README 真實支援範圍。

**Interfaces:** 沿用 Task 1 契約，不為適配而在本專案實作轉錄或配對；loader 只能指向收到並固定版本的實際發布物。

- [ ] 核對關卡 A 與 binding capability／實際 API；缺 prepare、原文輸出順序、取消或必要進度等契約時，列具體差異讓對方專案補齊，本任務保持未完成。
- [ ] 寫契約測試：真實 session 以使用者授權本機英文音檔與逐行歌詞回傳有限 segments，align 同數同序同原文，prepare 真實進度，abort/dispose 可完成；素材不提交。
- [ ] 跑 `npx --no-install vitest run tests/integration/library-binding.test.ts`，沒有 binding 時標 unmet prerequisite，不以 skip 全綠聲稱通過。
- [ ] 接上固定 library；檢查 MV3／offscreen／WebGPU／Worker 資產路徑與 CSP。多語言不自行擴充；unsupported language 顯示錯誤。
- [ ] 跑契約測試、所有 unit/integration、typecheck、build/package；在真實 Chrome 執行 `npx --no-install playwright test tests/e2e/subtitle-library.spec.ts`：影片不被 pause/seek、關面板繼續、切片不污染、完整發布、未匹配零發布、已時間碼零模型。
- [ ] 記錄裝置、模型版本、真實處理時間、取消與釋放結果；文字／時間合法不代表演唱精準，不能拿 score 宣稱準確率。
- [ ] 完成必要 code review、確認 clean diff 與文件真實性；依 make-git 提交 `feat: connect verified lyric-align-ts binding`。只有此任務與關卡 A 都完成，才可宣稱無時間碼端到端整合完成。

## 依賴與交付順序

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`。這是保守的單一路徑；UI task 在協調資料穩定後進行。Task 8 是內部變更收斂點，在它之前分支不作可發布宣稱。Task 9 是實際 library 可用性的關卡；無 library 仍可交付完整時間碼路徑與誠實的不可用狀態，但整體需求保持部分未完成。

執行方式：使用者已選擇本 session 原生逐項實作。產品修改與任務提交已授權；不修改 library，不部署。關卡 A/B 尚未通過，獨立下載、offscreen 真實推論、佇列／資源釋放與 Task 9 仍待實際外部能力驗證。

## 計畫自查

- Spec 覆蓋：搜尋 Task 5；音訊 Task 3；library 邊界 Task 1/4/9；結果與原文 Task 1/6；生命週期 Task 2/4；UI Task 7；移除／遷移／建置 Task 8。
- 介面一致：跨任務使用同一 JobKey、PreparedLyrics、ResultValidation、AudioHandle、核准 library contract；消息採 handle，不直接傳 PCM。
- Review Focus 五項都有測試擁有者，命令採現有 Vitest／Playwright config。
- 關卡 A/B 明列未驗證項，不以 mock 代替真實能力。不在計畫編寫階段跑產品建置或觸發舊模型下載。
