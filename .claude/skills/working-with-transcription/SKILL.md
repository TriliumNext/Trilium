---
name: working-with-transcription
description: Use when working on Trilium's meeting transcription — the desktop pipeline in `apps/desktop/src/services/transcription/` (capture window, Silero VAD, Parakeet via sherpa-onnx-node, sinks and audio taps), the `transcript` attachment and `TranscriptView`, the "Transcribe meeting" launcher, the standalone WebAssembly prototype, speaker detection (diarization), any change to recognition quality (decoding method, beam search, hotwords, VAD settings, a different model), or audio capture (stutters, clicks, the capture worklet). Includes replay.mjs (re-transcribes a recording with changed settings), compare.mjs (word-by-word diff with an error rate), external.mjs (scores against another tool's export), hotwords.mjs (builds the BPE vocabulary and checks a glossary), diarize.mjs, capture-check.mjs, capture-test.mjs and worker-test.mjs. Don't judge an engine change by ear or from one live meeting; replay a recording and compare.
---

# Working with transcription

Desktop transcribes a meeting on the user's machine, once the synced option `transcriptionEnabled` ("Meeting transcription" in the header of Options → Transcription, off by default while the feature is in beta) is on; until then the launcher renders nothing and the page shows only that switch: no audio leaves it, and none is kept unless the user turns on "Keep recordings for troubleshooting". Standalone has only a prototype (`apps/standalone/transcription-poc/`, see its README).

## The pipeline

```
capture window (hidden, offscreen)              transcription process (Electron utility process)
  getUserMedia ─ microphone ─┐ AudioWorklet "chunk-collector" (audio thread)
  getDisplayMedia ─ system ──┴─ MessagePort, { source, samples } of 4096 Float32 samples
                                   │
                         RecordingSession ── audio taps (dev: WavRecorder → *.wav)
                                   │
                  per source: SourcePipeline → VadSegmenter (Silero, 512-sample windows)
                                   │ utterances
                  one queue: recognizer.transcribe() (Parakeet TDT 0.6B v3, fp32 or int8, libuv pool)
                                   │ speakers: EmbeddingSpeakerTracker (TitaNet, synchronous),
                                   │   splits an utterance at a change of speaker
                  sinks: posted to the main process, dev: TranscriptFileSink
                                   │ parentPort: ready / pending / level / utterance / log / stopped
main process: TranscriptionWorker → AttachmentSink (transcript attachment)
              state broadcast "transcription-state" (status, noteId, pendingSources,
                sourceIssues, error); each chunk's RMS on "transcription-level"
```

The main process opens the capture window, starts the transcription process and connects the two with a `MessageChannelMain`; per chunk it does nothing, per utterance it writes the attachment. Each recording gets a process of its own, which loads the model (~1.3 s) and exits after `stop`.

- **Stopping** runs in order: `CaptureWindow.stop()` calls the page's `finishCapture()`, which flushes each worklet's partial chunk (padded with silence to whole 512-sample VAD windows) and posts `{ end: true }`; then the process, told to stop, waits for that marker (it travels on another port than the stop request, up to 2 s) before flushing the VADs and the decode queue.
- **Source issues**: `updateSourceIssues()` in the main process (on every level and every second) keeps `sourceIssues`, at most one issue per source: `not_captured` for a source `CaptureWindow.start()` did not return (it never gets a `lastHeard`), `no_audio` once it has delivered no chunk for 10 s (`NO_AUDIO_MS`), and `silent` once every chunk has had an RMS of exactly 0 for `SILENCE_MS` (microphone 15 s, since a working one always picks up some noise; system 60 s, since the loopback is digital silence whenever nobody speaks, so a quiet meeting can trip it). The last two clear on the next chunk or the next sound. `TranscriptRecordingLevels` (in `TranscriptView.tsx`, fed by `onLevel()`, shown while its meeting records in the header of the pinned section through `Collapsible`'s `headerActions`) marks the source _Not captured_, _No audio_ or _Only silence_; the launcher turns its time badge red and shows an error, one per source and issue, saying which source and what to do.
- **Quitting** during a recording is held back (`before-quit`) until that stop finishes, at most 15 s.
- **Failures** reach every window as a state with an `error`, which the launcher shows as a toast; `getState()` never returns it. The process dying ends the recording, keeping what was written; the capture page crashing or every source ending (`render-process-gone`, a track's `ended`) stops it normally, transcribing what was captured; a transcript that cannot be saved (a protected note while the protected session is locked) is reported once and kept in memory, and `AttachmentSink.save()` writes it on the next utterance or on `ENTER_PROTECTED_SESSION`.

| File | Owns |
|---|---|
| `apps/desktop/src/services/transcription/capture.ts` | Main process: `CaptureWindow`, the hidden capture window and its page; microphone and loopback system audio; `CAPTURE_PROCESSOR`, the worklet that cuts each source into chunks (`capture-test.mjs` reads it from this file) |
| `…/index.ts` | Main process: IPC handlers, the state broadcast, `getRecordingDirectory()`; registers the model resource, starts a recording's process and capture window and connects them |
| `…/model.ts` | Main process: the three models as downloadable resources (`RECOGNIZER_MODELS`, one per precision, `VAD_MODEL`, `SPEAKER_MODEL`: URLs pinned to a revision, sizes, SHA-256) and `getModelPaths()`, which resolves the `ModelPaths` a recording starts with |
| `…/worker_client.ts` | Main process: `TranscriptionWorker`, which forks the transcription process, relays its events and stops or kills it |
| `…/attachment_sink.ts` | Main process: the `transcript` attachment, rewritten after every utterance |
| `…/protocol.ts` | Both: the messages between the processes, `SAMPLE_RATE`, `Logger` |
| `…/transcription_worker.ts` | The transcription process's entry (bundled as `transcription_worker.cjs`): `PortCapture`, the session, the dev sinks and taps |
| `…/engine.ts` | Transcription process: `loadSherpaEngine(models)`: recognizer and VAD settings (`RECOGNIZER_SETTINGS`, `DECODING_SETTINGS`, `VAD_SETTINGS`), reported as `settings` |
| `…/session.ts` | Transcription process: `RecordingSession`: per-source segmentation, the decode queue, sinks, taps, pending sources |
| `…/audio_recorder.ts` | Transcription process: recordings for troubleshooting, `WavRecorder` and `TranscriptFileSink` |

Nothing the transcription process imports may reach `@triliumnext/core` or `@triliumnext/server` (the data directory module creates directories when it loads): it gets its paths and a `Logger` from the main process.
| `packages/commons/src/lib/transcript.ts` | The `Transcript` format (`version: 1`, `startedAt`, `speakers`, `utterances`), `parseTranscript()`, speaker keys and `setSpeakerName()`; `cleanUtteranceText()`, the filler and stutter cleanup |
| Cleanup | The stored transcript stays verbatim. `TranscriptView` shows each utterance through `cleanUtteranceText()` while the synced option `transcriptCleanupEnabled` (default on, the "Hide filler words" switch above the transcript) holds, and leaves out utterances it empties; with the switch off, it grays out the words the cleanup would remove, from `markDisfluencies()`, which shares its pass with `cleanUtteranceText()`. The rules are English-only for stutters (a function-word list) and keep numbers, comma-separated repeats and "that that"/"it it" |
| Speaker names | While a recording writes the transcript, `TranscriptView` renames through `electronApi.transcription.renameSpeaker(attachmentId, …)` (by attachment, since a note can hold an older transcript beside the running one): `AttachmentSink`, the only writer then, applies `setSpeakerName()` to the stored names in one transaction, so no utterance is overwritten. Otherwise it saves the stored transcript whole through the generic `POST notes/:noteId/attachments?matchBy=attachmentId`; attachments get no route of their own. `AttachmentSink` re-reads `speakers` before each rewrite, so a rename from another window or device survives the next utterance |
| `apps/client/src/widgets/type_widgets/transcript/TranscriptView.tsx` | Turns, clock times, the "Speaking…" line, fade-in, the level meters (`TranscriptRecordingLevels`) |
| `apps/client/src/widgets/launch_bar/RecordMeetingButton.tsx` | The launcher and `useTranscriptionState()` |

## The model

Users choose the recognizer under Options → Transcription: the non-synced option `transcriptionModel` holds a key of `TRANSCRIPTION_MODELS` (commons `transcript.ts`), `parakeet-int8` (the default, "Standard") or `parakeet-fp32` ("High accuracy"), each naming its resource and precision; an unknown value reads as the default (`getTranscriptionModel()`). The synced option `transcriptionSpeakersEnabled` (the "Identify speakers" switch, default on) decides whether a recording labels speakers. The launcher calls `requireResources(getTranscriptionResources(<model>, <speakers>))` before it creates the meeting note, which shows the download dialog for those missing (TitaNet only while the switch is on), and `startRecording()` resolves the same two options through `getModelPaths()`, which passes `speaker: null` while the switch is off. The models are resources of the resource manager (`apps/server/src/services/resources.ts`), each in `<data dir>/resources/<id>-<hash>/` and checked against the SHA-256 in `model.ts`: `transcription.parakeet` (int8, 670 MB), `transcription.parakeet-fp32` (2.5 GB, pinned to a Hugging Face revision), `transcription.silero-vad` (0.6 MB) and `transcription.titanet` (40 MB). The hash in the directory name covers every file's path and SHA-256, so changing a file of one model downloads that model alone again, into a new directory. A recording needs Parakeet and Silero; without TitaNet it labels no speakers.

`ModelPaths.recognizer` carries the precision with the directory, and `loadSherpaEngine()` loads that precision's files; it records it as `precision` in the engine settings and applies `blankPenalty` to int8 only (see "Findings so far"). Full precision loads in ~2 s to ~2.3 GB RSS.

The scripts below read the downloads of `pnpm desktop:start`, in `apps/desktop/data/resources` (`findResource()` in `recordings.mjs`, which takes the most recently installed directory of a resource); download a model by starting a recording there with it selected, or point `--model` at another Parakeet directory. Files copied into a resource's directory by hand are adopted on the next download once their SHA-256 matches, so a copy from another machine needs no new download.

A recording started without its models fails with `transcription.model-not-downloaded`. `replay.mjs` takes the precision `recording.json` names (int8 for recordings made before it was recorded) and falls back to the other.

## Recordings for troubleshooting

While the non-synced option `transcriptionKeepRecordings` is on (Options → Transcription → "Keep recordings for troubleshooting", off by default, its switch tinted red), every transcription is kept in `<data dir>/transcription-recordings/<created>_<noteId>/`; for `pnpm desktop:start` that is `apps/desktop/data/transcription-recordings/`, so turn the switch on there once to get recordings for the scripts below. Development builds follow the switch like any other. While the switch is on, the settings link to the folder through `electronApi.transcription.getRecordingsDirectory()`, which creates it; with the switch off, they never ask, so nothing creates the folder.

| File | Holds |
|---|---|
| `microphone.wav`, `system.wav` | Mono 16 kHz 16-bit PCM, ~115 MB per hour each; the header is rewritten every chunk, so a crash leaves them playable |
| `recording.json` | `noteId`, `startedAt`, `sampleRate`, `engine` (the settings used), each source's `firstSampleOffsetMs` |
| `transcript.json` | The live transcript, in the attachment's format |
| `transcript.<label>.json` | Replays, written by `replay.mjs`, with a `replay` block (settings, hotwords, timings) |

There is no clean-up: delete directories by hand.

## Replaying a recording

```bash
S=.claude/skills/working-with-transcription
node $S/replay.mjs latest --label greedy                       # the baseline: recorded settings
node $S/replay.mjs latest --label beam4 \
    --set recognizer.decodingMethod=modified_beam_search --set recognizer.maxActivePaths=4
node $S/replay.mjs latest --label hot --hotwords "Trilium/Becca/Froca" \
    --set recognizer.decodingMethod=modified_beam_search
node $S/replay.mjs latest --label vad04 --set vad.threshold=0.4 --set vad.maxSpeechDuration=6
```

- `latest` is the newest development recording; any recording directory works too.
- It starts from `recording.json`'s `engine` and applies each `--set` (JSON-parsed when it parses). Recognizer keys sherpa-onnx reads from `modelConfig` (`modelType`, `numThreads`, `provider`, `modelingUnit`, `bpeVocab`) go there; the rest (`decodingMethod`, `maxActivePaths`, `hotwordsFile`, `hotwordsScore`, `blankPenalty`, `ruleFsts`, `ruleFars`) go top level.
- It runs in plain Node with the desktop app's `sherpa-onnx-node`, segments with Silero exactly as `VadSegmenter` does, and times each decode: RTF is decode time over audio length.
- `--source system` replays one source; `--pad <seconds>` decodes each segment with that much extra audio on both sides; `--force` replaces a label.

## Comparing transcripts

```bash
node $S/compare.mjs latest                    # list every transcript with its settings and RTF
node $S/compare.mjs latest greedy beam4       # word diff of beam4 against greedy
node $S/compare.mjs latest reference beam4    # beam4's word error rate against a corrected one
```

Per source it counts substitutions, deletions and insertions over the first transcript's words, and lists each difference with its time: `[-removed-] {+added+}`. Casing and punctuation are ignored unless `--strict`.

To measure accuracy rather than difference, make a reference: copy the baseline to `transcript.reference.json` and correct only the `text` fields by listening to the WAVs. `reference` always counts as the ground truth, whichever side it is given on.

When another tool transcribed the same meeting (a Teams or AppFlowy export, one `Name: text` line per turn), `external.mjs` scores every transcript against it, the microphone against the lines of `--me` and the system source against everyone else, and counts glossary terms:

```bash
node $S/external.mjs <recording> "<export>.txt" --me Elian live fp32 --terms "heap/STM32/Renesas"
```

The export has errors of its own (it wrote "MicroEdge" and "SortMap", and split words between speakers), so only the difference between labels means something. It writes numbers as digits and drops many fillers, which caps how close any of our transcripts can score.

## Speaker detection

The app labels the system source's utterances live while TitaNet (`transcription.titanet`) is installed and "Identify speakers" is on: `EmbeddingSpeakerTracker` in `engine.ts` embeds each transcribed utterance and `SpeakerClusterer` (`speakers.ts`, settings `SPEAKER_SETTINGS`) assigns it, giving the utterance a `speaker` number that `TranscriptView` shows as "Speaker n". The microphone is never labelled. It runs synchronously in the transcription process, holding back the next chunks but nothing else. `replay.mjs` does not label speakers; use `diarize.mjs`.

**Turns within an utterance** (`TURN_SETTINGS`): a VAD segment holds both sides of a quick exchange, since a reply needs no 0.75 s pause. Once a speaker is known, an utterance of 4 s or more is embedded again in 2 s windows 1 s apart, each matched against the known speakers (`SpeakerClusterer.match()`, which moves no centroid); where another label holds for two windows (`findSpeakerChanges()`), the utterance is cut half a second into the new run, moved to the nearest word start within 1 s, preferring one after a sentence end (`snapToWordBoundary()`, on the token times Parakeet returns with `transcribe()`). `RecordingSession` writes each turn as an utterance of its own, its text the words starting in it. That costs one embedding per second of a long utterance, ~0.1–0.3 s for a 20 s one.

On the 67-minute meeting of 2026-10-15 (two people on the system track), scored per second against voice prints of the two named speakers: 7.3% of the speech had the wrong or no speaker before turns, 2.7% after (two speakers, 502 → 560 utterances). The reference was built with the same model and similar windows, so the gain is likely overstated; the cuts read right in the text ("…for us? | Yes, but…", "Have a nice day. | Thank you. Have a nice day. Bye.").

`diarize.mjs` labels one source's utterances by speaker in two ways and times both:

- **live**: one embedding per utterance, in arrival order, joined to the closest speaker heard so far when the cosine similarity reaches `--threshold` (0.5). Below it, an utterance of at least `--new-min` (5 s) starts a new speaker; a shorter one joins the closest speaker, from `--short-threshold` (0.3) on when it is shorter than `--min-duration` (1.5 s), and only utterances of `--min-duration` or more move a centroid. This is what runs during a meeting (`SPEAKER_SETTINGS`).
- **offline**: sherpa-onnx's `OfflineSpeakerDiarization` over the whole source (pyannote segmentation, embeddings, clustering), mapped onto the utterances by overlap; `+Dn` marks an utterance in which a second speaker talks ≥ 1 s.

```bash
node $S/diarize.mjs latest                                   # both, TitaNet, system source
node $S/diarize.mjs latest --mode offline --clusters 2       # when the speaker count is known
node $S/diarize.mjs latest --embedding campplus --threads 2
```

TitaNet is the app's download (`transcription.titanet`). The models only `diarize.mjs` uses go in `apps/desktop/data/diarization-models/` (or `--models <dir>`), from `k2-fsa/sherpa-onnx` releases:

- `3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx` (30 MB) from `speaker-recongition-models` (the tag is misspelled upstream);
- `segmentation.onnx` (6 MB): `model.onnx` of `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` from `speaker-segmentation-models`, renamed.

`SpeakerEmbeddingExtractor.compute()` and `OfflineSpeakerDiarization.process()` are **synchronous**, with no async variant. Live labelling therefore runs in the transcription process, never in the main process, which also serves the backend. The offline method, ~20 s per two minutes, would stall even that process's capture for its duration.

Results on the first recording (two minutes, interviewer and curator on the system track, one thread):

| Method | Speakers found | Correct | Time for 117 s | CPU |
|---|---|---|---|---|
| live, TitaNet | 2 | Every single-speaker utterance; the other speaker scored 0.25 against 0.60–0.90 | 1.2 s (RTF 0.010), ~100 ms per utterance | ≈ wall |
| live, CAM++ | 4 | Split both speakers | 1.4 s | ≈ wall |
| offline, TitaNet, threshold 0.5 (default) | 6 | Over-split | 16.8 s (RTF 0.143) | ≈ wall |
| offline, TitaNet, threshold 1.0 or `--clusters 2` | 2 | As live, and flagged the 4 utterances where the interviewer cuts in | 20.7 s (RTF 0.177); 11.7 s on 2 threads | 20.6 s; 23.3 s on 2 threads |
| offline, CAM++, `--clusters 2` | 2 | Wrong split | 18.4 s | ≈ wall |

Two distinct voices on a clean recording are the easy case; similar voices, more speakers and call-quality audio are untested.

## Measuring a change

- **Compare against a replay, never against `transcript.json`.** The live recognizer decoded Float32 samples; a replay decodes the 16-bit WAV, and that rounding alone changed 4.1% of the words on the first recording with identical settings and identical segments. Replays of the same WAV are deterministic (0.0% between two runs), so the baseline is `replay.mjs --label greedy` with no overrides.
- **One recording is an anecdote.** Check a change on several, with both sources, a non-native speaker, and another language; Parakeet v3 handles 25.
- **A VAD change moves segment boundaries**, and the recognizer sees different context, so part of any difference is boundaries, not recognition.
- **Compare RTF only on one machine with nothing else running.** It was 0.125–0.127 for consecutive runs of one recording here; the PoC commit's ~0.03 came from a faster machine.
- **Check hotwords took effect**: they need `modified_beam_search` (with `greedy_search` sherpa ignores them without a word), and the replay's output must show no `Encode hotwords failed` line. See "Hotwords".

## Hotwords

Without a BPE vocabulary, sherpa looks a hotword up as a single entry of `tokens.txt`, so an ordinary word fails ("Cannot find ID for token androgynous") and **one failing term drops the whole list** for that utterance. The Parakeet archives ship no vocabulary; `hotwords.mjs` builds one:

```bash
node $S/hotwords.mjs vocab                          # bpe.vocab beside the downloaded Parakeet
node $S/hotwords.mjs vocab <model dir>              # or beside another one
node $S/hotwords.mjs check "heap/STM32/Iconiq"      # how each term splits, and which are risky
node $S/replay.mjs <rec> --model <dir> --label hot --hotwords "heap/STM32/Stéphane" \
    --set recognizer.decodingMethod=modified_beam_search --set recognizer.maxActivePaths=4 \
    --set recognizer.modelingUnit=bpe --set recognizer.bpeVocab=<dir>/bpe.vocab \
    --set recognizer.hotwordsScore=1.5
```

`vocab` scores each piece by the rank of the merge that forms it, so a term splits as the model splits it (`▁J ava ▁he ap`). sherpa's own recipe gives every piece the same score (longest match); on the 44-minute call that missed Stéphane and Renesas, which the ranked vocabulary found.

**sherpa's NeMo beam search keeps the boost of a hotword's first piece** (`offline-transducer-modified-beam-search-nemo-decoder.cc`, 1.13.8): the global `hotwordsScore` is added to the logits before the hypothesis score is read from them, and `Finalize()` takes back only the context-graph score of an unfinished match. Every token that starts a hotword is therefore boosted everywhere, finished or not. A per-phrase score (`term :2`) does not avoid it, since the pre-boost uses the global score; a global score of 0 still left stray words, through pruning. What works is keeping such entries out of the list: `check` flags a term whose first piece is a common word on its own (`Iconiq` → `▁I`, which put 19–25 stray "I" into the call; `heap` → `▁he`).

What a glossary needs, from that call:

- **Score 1.5.** At 3, "SOAR" appeared 161 times.
- **Only terms spoken as they are written.** MicroEJ is said "micro-edge" and came out as "MicroE", "MicroEs", "MicroEch", worse than without it; IntelliJ became "Intel J". Those need a rewrite after recognition ("micro edge" → MicroEJ), not a hotword.
- **No names that open like common words or other names**: Claire turned "Clear for me" into "Claire for me"; the Al- names produced "Alan White." and "Albert?".
- **Drop terms the model already gets** (Iconiq was 10/10 without a hotword).
- **The full-precision model.** On int8, beam search costs more than hotwords gain (microphone WER 17.0% against 15.3% greedy).

## Capture quality

```bash
node $S/capture-check.mjs latest            # breaks at chunk boundaries, clipping, digital silence
node $S/capture-test.mjs                    # the capture worklet vs the old ScriptProcessor, page busy
node $S/capture-test.mjs --capture worklet --load all --seconds 30
node $S/capture-test.mjs --stereo           # a left-only tone must arrive at amplitude 0.25
node $S/capture-test.mjs --fused            # on a copy of Electron with the packaged builds' fuses
```

`capture-check.mjs` compares the step between neighbouring samples at each 4096-sample chunk boundary with the steps around it: about 1.0–1.3 is a clean join, about 2 means the capture corrupts the start of chunks, heard as a crackle four times a second. It also counts **dips**, 10 ms windows that fall to near silence between loud stretches and fade back within 40–70 ms, per minute with the worst minute.

Dips are a second, separate defect, of the system loopback alone. In the Romanian Google Meet call they came at 3.4 a minute, up to 18, in a burst from minute 3 to 13 while the machine shared Figma from Chrome and the user typed in another Trilium; the microphone had none, the English Teams call 0.09 a minute. The user heard the call cleanly, so the audio was lost by the capture, and inside chunks (not at their boundaries), so upstream of `CAPTURE_PROCESSOR`: Chromium reading the loopback, or delivering it to the hidden page, late under load. `backgroundThrottling: false` might help on Windows, where Chromium lowers the priority of hidden windows; unverified, and `capture-test.mjs` cannot reproduce it, since its tone never passes through the loopback.

`capture-test.mjs` runs the capture for real: Electron (Nix-aware, as `scripts/electron-start.mts`) opens a hidden offscreen window like `createCaptureWindow()`, plays a 440 Hz tone from a 48 kHz context into a `MediaStream` and captures it at 16 kHz with `CAPTURE_PROCESSOR` read from `capture.ts`, under a chosen load (`jank`: the page busy 300 ms of every 500; `block`: the main process blocked 150 ms a second; `burn`: every core busy). A pure sine is predictable from its two previous samples, so every break shows. The node options in its page mirror `pipe()` in `capture.ts`; change both together.

The capture used a `ScriptProcessorNode` until the recordings showed breaks at every chunk boundary (ratio 1.6–2.35 on both tracks of three meetings). Its callback runs on the page's main thread, and when that thread is late Chromium hands it input whose first 128–640 samples (whole 128-frame render quanta) are corrupt, without changing the length. Under the `jank` load it broke 6–8 times in 20 s and 13 times in 30 s under `all`; the worklet, which runs on the audio thread, broke none. Saturating the CPU alone broke neither.

## The transcription process

```bash
node $S/worker-test.mjs latest                         # 120 s of system.wav at 4× real time
node $S/worker-test.mjs latest --source microphone --seconds 60 --speed 8
```

`worker-test.mjs` runs the real `TranscriptionWorker` in Electron: it starts the transcription process on the app's downloads in `apps/desktop/data/resources` (or the Parakeet of `--model`; `--out` writes the utterances), and a hidden page posts a recording's WAV through a `MessageChannelMain` port as the capture page does. It prints the engine's load time, the utterances (with speakers), how long `stop` took and whether the process exited, and the main process's event-loop lag throughout. On two minutes of a meeting's system track: ready after 1.3 s, lag p50 0.1 ms, p99 1.1 ms, max 25 ms. Before the split, speaker labelling alone held the main thread 15–100 ms per utterance. On Windows, Electron launched by it prints nothing and runs into the timeout (unresolved); there, `RecordingSession` and `loadSherpaEngine()` can be driven in plain Node with `node --import tsx` instead, feeding the WAV in 4096-sample chunks, which tests everything but the process boundary.

In development the process loads `transcription_worker.ts` through the `NODE_OPTIONS="--import tsx"` it inherits from `scripts/electron-start.mts`; built, `worker_client.ts` finds `transcription_worker.cjs` beside `main.mjs`. `sherpa-onnx-node` is external to every bundle: `copySherpaOnnx()` in `apps/desktop/scripts/build.ts` copies it and the target's platform package (`sherpa-onnx-win-x64`, …) into `dist/node_modules`, and `forge.config.ts` unpacks the platform package from the asar, since the OS loads its shared libraries. `pnpm --filter @triliumnext/desktop electron-forge:test-packaged` checks a package from outside the repository, where nothing resolves from the workspace.

## Findings so far

On the first recording (two minutes of system audio, English interview), against the `greedy` replay:

| Change | Words changed | RTF | Notes |
|---|---|---|---|
| `modified_beam_search`, 4 paths | 1.6% | 0.099 (greedy 0.127) | Faster, but all five changes were deletions of spoken words |
| Hotwords as plain words | 0% | — | Not applied: the terms did not encode (above) |

On a 44-minute Teams call (both sources, English, non-native speakers), scored against another tool's transcript of the same call, so only the change between rows counts. The current `blankPenalty`, `maxSpeechDuration` and `minSilenceDuration` come from this run:

| VAD (max / silence), decoding | Microphone WER | System WER | Notes |
|---|---|---|---|
| 8 s / 0.5 s, greedy (previous) | 17.0% | 27.1% | 702 utterances, 187 under 1 s |
| 20 s or 30 s / 0.5 s, greedy | 16.4% | 26.9% | Identical: no segment reached 20 s; the 0.5 s silence ends them first |
| 20 s / 0.75 s, greedy | 15.7% | 25.8% | Merged segments recover words; three clauses dropped |
| 20 s / 1.0 s, greedy | 16.8% | 25.7% | |
| 20 s / 1.5 s, greedy | 18.6% | 24.1% | Parakeet drops 15–30-word clauses inside long segments with pauses |
| `modified_beam_search`, 4 paths | 17.8–24.9% | 25.9–27.5% | Worse at every silence setting |
| 20 s / 0.75 s, `blankPenalty` 0.5 (current) | 15.3% | 26.7% | Recovers every dropped clause; the system score drops only because the speaker’s repetitions ("I I I", "no no") now appear |
| `blankPenalty` 1 / 2 | 15.7 / 16.3% | 27.8 / 31.4% | Garbled extra words |
| 20 s / 1.5 s, `blankPenalty` 1 | 15.3% | 26.6% | The penalty fixes the 1.5 s drops too, at more latency |
| VAD threshold 0.4 / 0.3 | 15.6 / 16.0% | 25.8 / 26.0% | 0.3 recovers one quiet passage; otherwise noise |
| `--pad` 0.2 / 0.4 s | 17.3 / 24.4% | 24.5 / 25.3% | Parakeet drops whole clauses again |
| Full precision, greedy, no penalty | 13.3% | 24.9% | RTF 0.021 (int8 0.013); peak memory +1.6 GB; drops no clauses, so needs no `blankPenalty` (0.5 only adds junk on the system track) |
| Full precision, beam 4 + a 27-term glossary at 1.5 | 13.4% | 24.8% | "heap" 47 times (the other tool: 47; int8: 29), "hip" 0 (8), STM32 3/3, Stéphane 3/3, Renesas 1/1 |

On a 67-minute meeting (2026-10-15, three people, English, non-native speakers, full precision), scored with `align.mjs`-style alignment against an AppFlowy export that covers only its first 23 minutes and has no speaker names, both sources merged by time. The current VAD `threshold` and `minSpeechDuration` come from this run:

| VAD threshold / min speech | WER | Sub / del / ins | Notes |
|---|---|---|---|
| 0.5 / 0.25 s (previous) | 12.1% | 116 / 69 / 141 | ~18 short replies missing ("okay" ×8, "yes", "nope", "sounds good"); only 3 of ~670 segments decode empty, so the VAD is the cause |
| 0.4 / 0.25 s | 12.1% | 109 / 64 / 153 | |
| 0.3 / 0.25 s | 12.0% | 109 / 58 / 155 | |
| 0.5 / 0.1 s | 11.7% | 103 / 58 / 153 | |
| 0.3 / 0.1 s (current) | 11.3% | 97 / 51 / 156 | 53 more segments over the meeting, 51 with text (mostly "Yeah", "Okay", "Mm"); segments start earlier, so clipped first syllables return: "Peace." → "For this.", "I don't see what to go through." → "For us, you want to vote or not?" |

The export leaves out many "yeah"s, so each one recovered counts as an insertion and the gain is understated. Against this, the Teams call (int8, above) had the microphone 0.7 points worse at threshold 0.3.

The same 31-minute Romanian meeting (no reference, judged by reading): int8 is often nonsense ("Pă2, așa, să interinteg navigator"), full precision mostly readable ("Să integrăm navigatorul") but 62% of the microphone words differ between the two. Both slip into Spanish and Portuguese ("só", "como"), as Parakeet guesses the language per segment and cannot be told it; full precision drops diacritics on common words twice as often (82 against 36 of să/și/că/adică…). Whisper with a fixed language (sherpa-onnx supports it) is the untested next step.

## Traps

- **Electron's V8 memory cage** rejects sherpa-onnx's external buffers: in the app, `vad.front(false)` (and `readWave(…, false)`). Plain Node, as in `replay.mjs`, does not need it.
- **Capture chunks must stay a multiple of 512 samples.** `VadSegmenter.accept()` feeds whole 512-sample windows and drops a remainder; `CHUNK_SAMPLES` (4096) divides evenly.
- **Never capture with a `ScriptProcessorNode`.** Its callback runs on the page's main thread and corrupts chunk starts when that thread is late (see "Capture quality").
- **The capture worklet needs `channelCount: 1` with `channelCountMode: "explicit"`** to down-mix a stereo loopback to mono; with the default, `inputs[0][0]` is the left channel alone. `numberOfOutputs: 0` is fine: Chromium still runs the node.
- **`ELECTRON_RUN_AS_NODE=1` is set in a VS Code terminal**, and turns the Electron binary into plain Node (`Cannot find module 'electron'`). `capture-test.mjs` clears it; clear it for any Electron script run from there.
- **No top-level `await` in an ESM Electron entry**: it holds back `ready`, and the app hangs without output.
- **A `MessagePortMain` receives a message whose buffer was transferred as `null`.** The capture page posts each chunk without a transfer list, so it is copied (16 KB).
- **The transcription process must not throw from a port listener**: an uncaught exception ends it, and the recording with it. `RecordingSession` catches per chunk.
- **`maxSpeechDuration` is not a hard cut**: past it, sherpa lowers the minimum silence to 0.1 s and raises the threshold to 0.9, so a segment ends at the next short gap, typically 1–2 s later.
- **Packaged builds run with different fuses than development.** `GrantFileProtocolExtraPrivileges` is off there, so the capture page, a `file://` page, has an opaque origin and a `blob:` worklet fails to load ("Not allowed to load local resource: blob:null/…"); the worklet loads from a `data:` URL. Check a change to the capture page with `capture-test.mjs --fused`, which flips `FUSES` from `flip-fuses.ts` on a copy of Electron; the plain run cannot show this class of failure.
- **The capture window must be `offscreen`**: a hidden window renders no frames without it, and the self-capture that yields system audio times out. `getDisplayMedia()` needs a user gesture, which only `executeJavaScript(…, true)` gives a hidden window.
- **Chromium's audio processing is applied during capture**, so the WAV already holds it and no replay can switch it off. The system track runs with echo cancellation, noise suppression and auto gain all off; the microphone keeps echo cancellation, so the meeting played through speakers is not transcribed twice, and its auto gain. Earlier recordings, including the one under "Findings so far", had noise suppression on both tracks and echo cancellation on the system track, so do not compare transcripts across that change.
- **A silent system source** usually means the sink's monitor volume is near zero (seen at -66 dB); the per-source peak logged every 5 s shows it.
- **Prebuilds**: `sherpa-onnx-node` has none for win-arm64. `provider: "trt"` exits the process with an offline model.

## Tests

```bash
pnpm --filter @triliumnext/desktop test transcription
pnpm --filter @triliumnext/client test TranscriptView RecordMeetingButton
pnpm --filter @triliumnext/commons test transcript
```

The desktop specs fake the engine, the capture and the utility process; nothing loads the model, runs the capture page or forks a process. Changes to recognition quality are measured with the scripts above, not with specs, a change to the capture page with `capture-test.mjs`, and a change to the process split or its protocol with `worker-test.mjs`.
