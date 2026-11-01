# Transcription in the browser (prototype)

Checks whether meeting transcription can run locally in standalone, with the sherpa-onnx WebAssembly
build instead of the native `sherpa-onnx-node` addon desktop uses. Not part of the standalone build:
it sits outside Vite's `src` root and is served by its own server.

```bash
node apps/standalone/transcription-poc/fetch-assets.mjs   # once: the wasm build and Silero VAD into vendor/
node apps/standalone/transcription-poc/serve.mjs          # http://localhost:5555/
```

Pick a model, *Download to OPFS* (from Hugging Face, pinned revisions), *Load*, then *Transcribe clip*,
*Listen to the microphone* or *Listen to a tab*; the two live sources can run together, each with its own
VAD. Timings and the WebAssembly memory size go to the log.

*Listen to a tab* uses `getDisplayMedia`, so the browser asks which tab or screen to share, and audio
arrives only when "Share tab audio" (or "Share system audio") is ticked. Firefox and Safari return no
audio from it.

## How it works

- **The build.** The npm `sherpa-onnx` package is compiled with `NODERAWFS` and throws outside Node, and
  the GitHub releases carry no browser build of the recognizer. The only one published is the
  `web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc` Hugging Face space. Its binary contains every offline
  model type (NeMo transducers included); `fetch-assets.mjs` patches its loader so the baked-in 368 MB
  Chinese model is never fetched.
- **The models** stream from Hugging Face (which sends CORS headers) into OPFS, in a worker. Loading copies
  each file into Emscripten's MEMFS with `FS_createDataFile(..., canOwn)`, creates the recognizer, then
  unlinks the files.
- **Single-threaded.** Standalone sends `Cross-Origin-Opener-Policy` without
  `Cross-Origin-Embedder-Policy`, so it is not cross-origin isolated, and this build has no threads anyway.
- **The memory ceiling** is fixed by the build: 512 MiB initial, 2 GiB maximum.

## Results

Headless Chromium 153, Linux, 24 cores (one used). RTF is decode time over audio length.

| Model | Download | Load from OPFS | WebAssembly memory | Tab RSS | RTF | English | French | German |
|---|---|---|---|---|---|---|---|---|
| Parakeet TDT 0.6B v3 int8 | 670 MB | 1.3 s | 1,340 MiB | ~2.4 GiB | 0.22–0.25 | correct | correct | correct |
| SenseVoice Small int8 | 237 MB | 0.7 s | 609 MiB | ~1.2 GiB | ~0.11 | uppercase, small errors | empty | garbled |
| Moonshine base int8 | 287 MB | 0.9 s | 512 MiB | ~1.2 GiB | 0.05–0.10 | correct | translated to English | "1." |

Live microphone (Chromium's fake device playing the 17 s English clip, Silero VAD, 8 s maximum segment):
Parakeet delivers each utterance about 2.2 s after it ends, at RTF 0.22–0.26.

Not measured: Firefox and Safari (Playwright's Firefox does not start on NixOS), phones, slower CPUs.
