# lyric-align-ts 0.1.0

`release.zip` 是 `C:/Projects/lyric-align-ts/spike/dist/lyric-align-ts-0.1.0.zip` 的原始發布物，未修改內容。

- SHA-256：`c7a6c80b461891a23924328d6949063fd593f09fdb49521b6923df8678557fa9`
- 入口 SHA-256：`b9a67aea7c4710f1ff7262242e2cda97327b0685a1a25887a40969c9d2ddc25b`
- 契約版本 1；英文；WebGPU；small.en/q4；lyricsContext=false。
- 授權：ZIP 中的 `library/upstream.LICENSE`、`library/asr-upstream.LICENSE`。

建置驗證 ZIP 雜湊，移除 archive 外層 `library/`，完整保留其內部相對路徑並排除 sourcemap。禁止重打包入口或改寫演算法。模型權重不在 ZIP 中；執行時按需下載。

目前 MV3 真實推論被 runtime 動態 JS Blob 載入阻擋，詳見 [整合驗收](../../docs/lyric-align-integration.md)。
