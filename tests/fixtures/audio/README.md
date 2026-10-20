# 增量音訊測試素材

`tone.webm` 是本機 FFmpeg 產生的 48 kHz 雙聲道 Opus／WebM，總長約 8 秒，前 1 秒為靜音，其後為 440 Hz 音調；不包含任何歌曲或外部媒體。每個 cluster 最長約 500ms，以驗證整檔未取得前的解碼。

```powershell
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=7' -af 'adelay=1000' -ac 2 -c:a libopus -b:a 32k -cluster_time_limit 500 -y tone.webm
```

規格依據：[WebCodecs](https://www.w3.org/TR/webcodecs/)、[Opus 登錄](https://www.w3.org/TR/webcodecs-opus-codec-registration/)、[Matroska 元素](https://www.matroska.org/technical/elements.html)與[區塊／lacing](https://www.matroska.org/technical/notes.html)。
