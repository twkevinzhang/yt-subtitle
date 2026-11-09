# AI 歌詞字幕

Chrome MV3 擴充功能。在 YouTube 影片旁的面板找出歌詞，沒有時間碼時在本機把歌詞對齊到音訊，整首完成後才套用成字幕；處理期間不影響影片播放。

## 流程

1. 開啟影片後同時搜尋三個來源：**LRCLIB**、**留言區**、**Google**。LRCLIB 不用 AI；留言區與 Google 使用你設定的 AI 服務與模型額度。也可以改成直接貼入歌詞或 SRT。
2. 選一份歌詞。已有完整時間碼（SRT，或有起訖的字幕）就驗證後直接套用。
3. 沒有時間碼時在本機對齊：取得音訊 → 準備語音模型 → 對齊歌詞 → 套用字幕。音訊在背景小視窗載入播放器內容後擷取，語音模型與取得音訊同時準備。
4. 音訊與對齊結果依影片快取，重播或換歌詞時不必重做。

未匹配的行或不合法的時間不插補、不發布部分字幕。只有起點的 LRC 不推估結束時間。原文與換行保留，辨識文字不會取代歌詞。對齊語言支援英、日、中；未指定時由歌詞判斷。

## 設定頁

- **AI 服務**：端點、金鑰與模型。
- **字幕與搜尋**：影片載入時自動搜尋需明確開啟（預設關閉），會把影片資訊與實際留言送給 AI 服務並使用額度。Google 與留言搜尋的任務指示可自訂，回覆格式由程式附加，可隨時還原預設。含搜尋測試，以固定影片跑一次三路搜尋，不保存任何結果。
- **本機資料**：依影片列出已快取的音訊與對齊結果，可單筆或全部刪除。面板的「重新載入」會一併清除該影片的本機資料。

## 安裝

到 [Releases](https://github.com/twkevinzhang/yt-subtitle/releases) 下載 `ai-lyrics-extension.zip` 並解壓，在 `chrome://extensions` 開啟開發者模式後「載入未封裝項目」。語音模型不隨套件發布，首次對齊時才下載。

## 開發

```sh
npm ci
npm run typecheck
npm test            # vitest、打包與打包測試
npm run build       # 輸出 dist/
npm run package     # 另產生 artifacts/ai-lyrics-extension.zip
```

`dist/` 可直接載入。`tests/e2e/dashboard.html` 是用測試資料與本地協調器驅動真實 React 面板的頁面，不送出 AI 請求，也不含在發布物內。

對齊由固定版本的 `lyric-align-ts@1.0.2`（Whisper C++／WASM，需 cross-origin isolation，manifest 已宣告 COOP／COEP）負責；建置時從 `node_modules` 原樣複製，由 offscreen host 載入。本專案只處理音訊交接、排隊、進度、取消與結果驗證。介面契約見 `src/subtitle/library-contract.ts`。
