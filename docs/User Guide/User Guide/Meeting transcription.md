# Meeting transcription
> [!IMPORTANT]
> **Meeting transcription is in beta**
> 
> Meeting transcription is a new feature and is still in beta. It has not been tested on every operating system, audio setup and meeting application, so it might fail to capture the audio, miss part of a meeting or behave differently from what this page describes. Before relying on it for an important meeting, try it on a short call first.
> 
> If something does not work, please [report the issue](Troubleshooting/Reporting%20issues.md), mentioning your operating system and the meeting application you used. The _Keep recordings for troubleshooting_ option described below keeps what is needed to reproduce a problem.

Meeting transcription turns a meeting into text while it happens: Trilium listens to your microphone and to what the other participants say through your speakers, and writes down who said what in a new note. Recognition runs entirely on your device, so no audio leaves it (see _Privacy_ below).

Meeting transcription is available only in the desktop application. It is not available when Trilium is accessed through a browser, nor in the mobile application.

## Enabling meeting transcription

Meeting transcription is off by default. To turn it on, go to <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Transcription_ and turn on _Meeting transcription_. This adds the <span class="tn-icon bx bx-microphone"></span> _Transcribe meeting_ button to the <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, marked with a _Beta_ badge.

The speech recognition models are not part of Trilium. The first time you transcribe a meeting, Trilium asks to download them; see <a class="reference-link" href="Installation%20%26%20Setup/Downloaded%20resources.md">Downloaded resources</a> for the sizes and how to manage them. Each device downloads its own copy.

## Transcribing a meeting

1.  Press the <span class="tn-icon bx bx-microphone"></span> _Transcribe meeting_ button in the <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.
2.  If the models are not downloaded yet, confirm the download and wait for it to finish.
3.  Trilium creates a text note titled with the current date and time (for example _Meeting 2026-10-15 14:30_) in the <a class="reference-link" href="Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a>, opens it and starts transcribing. While it transcribes, the button turns into a <span class="tn-icon bx bx-stop-circle"></span> _Stop transcribing_ button and shows the time elapsed. Beside it, a reminder asks you to let everyone in the meeting know that it is being transcribed and to ask for their consent; it closes by itself after 10 seconds, or when you click it.
4.  To end the transcription, press the <span class="tn-icon bx bx-stop-circle"></span> _Stop transcribing_ button. Trilium finishes transcribing what was already said before it stops.

Only one meeting can be transcribed at a time. The note itself is an ordinary text note: you can take notes in it during the meeting, rename it or move it anywhere in the tree. It carries the `#meetingRecording` label.

Trilium tells you when your microphone or the meeting's audio is not being transcribed. It shows a message saying which one and why, the time on the button turns red and the button's tooltip says that some audio is not being transcribed:

*   **Not captured**: the transcription started without that audio, for example because there is no microphone or because Trilium was not allowed to record the screen and its audio. Connect the microphone or allow the recording, then stop the transcription and start it again.
*   **No audio**: nothing has arrived from it for 10 seconds, as when its capture hangs. Stop the transcription and start it again; what was transcribed until then is kept.
*   **Only silence**: it has delivered nothing but silence, for 15 seconds from your microphone or for a minute from the meeting. A microphone muted in your system's settings, or with a mute button of its own, does this. A meeting nobody speaks in for a minute does it too, so this message can be ignored when the others are just quiet.

Each message shows once. _No audio_ and _Only silence_ clear by themselves once sound arrives again.

If the transcription stops on its own, for example because the audio could no longer be captured, Trilium shows a message and keeps everything transcribed until then. Closing Trilium during a meeting waits for the transcription to finish first.

## The transcript

The transcript is stored as an [attachment](Basic%20Concepts%20and%20Features/Notes/Attachments.md) of the meeting note and is shown in a collapsible _Transcript_ section above the note's content. It updates as the meeting goes on, one paragraph per speaker turn, each with the time it started. While the meeting is being transcribed, the header of the _Transcript_ section shows the level of your microphone (_Me_) and of the meeting's audio (_Others_), so you can tell that both are being heard, even while the section is collapsed; a source that is not being transcribed is marked _Not captured_, _No audio_ or _Only silence_. While someone is talking, _Speaking…_ shows under their name until their words are transcribed. If you are reading the end of the transcript, it scrolls to follow new text.

The _Transcript_ section is expanded each time the note is opened. To collapse it, click its header; it stays collapsed only until the note is opened again.

The transcript is also listed among the note's attachments, under _Generated by Trilium_. Opening it from there shows the same view of the transcript. Deleting the attachment deletes the transcript, and the section disappears from the note.

*   What you say into your microphone is labeled _Me_.
*   What the other participants say is labeled _Speaker 1_, _Speaker 2_ and so on, while _Identify speakers_ is on; otherwise it is labeled _Others_.
*   To name a speaker, click their name, type the new name and press <kbd>Enter</kbd>. The name changes on every turn of that speaker. Press <kbd>Esc</kbd> to cancel, or clear the name to restore the default one.
*   To show the transcript with or without hesitations such as "uh", "um" and stuttered words, press the <span class="tn-icon bx bx-eraser"></span> _Hide filler words_ button above it, which shows as pressed while they are hidden. While they are shown, they are grayed out, so you can see what hiding them would remove. This affects only what is shown; the stored transcript keeps every word.
*   To copy the transcript as plain text, press the <span class="tn-icon bx bx-copy"></span> _Copy transcript_ button above it. Each turn is copied with the speaker's name and the time it started, as shown, so the copy leaves out filler words while they are hidden.

If the meeting note is [protected](Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) and the protected session is locked during the meeting, the transcript cannot be saved. Trilium keeps it in memory and saves it once you enter the protected session again, as long as Trilium stays open.

## Configuration

The settings are in <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Transcription_, and are shown once _Meeting transcription_ is on.

| Option | Description |
| --- | --- |
| _European languages_ | The speech recognition model. Both are versions of NVIDIA's Parakeet TDT 0.6B v3 model and recognize 25 European languages and work out which one is spoken. _Standard_ is a smaller download and runs well on most computers. _High accuracy_ makes fewer mistakes, but is a larger download and needs about 1.6 GB more memory while transcribing. A model is downloaded the first time you transcribe with it. |
| _Identify speakers_ | Tells the other participants apart and labels each of them separately, using the TitaNet model. Voices are compared only during the meeting: nothing about a voice is stored, and no one is recognized from one meeting to the next. Turn it off if it mixes up voices. The change applies from the next meeting. |
| _Keep recordings for troubleshooting_ | Keeps the audio of the meeting, the settings used and the transcript as it was produced, so that a problem can be reported and reproduced. It takes about 230 MB per hour of meeting and is never deleted automatically. The folder where they are kept is shown below the option. |

> [!WARNING]
> Before turning on _Keep recordings for troubleshooting_, ask everyone in the meeting to agree to being recorded. In several countries and US states, recording a conversation without everyone's consent is a criminal offense. The audio is stored unencrypted, even for protected notes. While the option is on, the tooltip of the _Transcribe meeting_ button says so, and the reminder shown when the transcription starts mentions that the audio is kept.

The sizes and licenses of the models are listed in <a class="reference-link" href="Installation%20%26%20Setup/Downloaded%20resources.md">Downloaded resources</a>.

## Privacy

Meeting transcription does not use any online service:

*   The audio is recognized on your device by the open-source sherpa-onnx engine. Trilium does not send the audio or the transcript to any online service, and no account or API key is needed.
*   An Internet connection is needed only to download the models, from Hugging Face and from the sherpa-onnx project on GitHub. Once they are downloaded, meeting transcription works offline.
*   Speaker identification compares voices only during the meeting. Nothing about a voice is stored.
*   The audio is not kept, unless _Keep recordings for troubleshooting_ is on. Those recordings stay in a folder on your device and are never synchronized.

The transcript itself is an attachment of the meeting note, so it is handled like the rest of your notes. If you use <a class="reference-link" href="Installation%20%26%20Setup/Synchronization.md">Synchronization</a>, it is synchronized to your sync server and your other devices. To keep it encrypted, transcribe into a [protected](Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) note: the transcript of a protected note is protected too.

## Limitations

*   Meeting transcription needs a speech recognition engine that does not load on every computer, for example on Linux distributions older than Ubuntu 22.04 or Debian 12. Where it does not load, the _Transcribe meeting_ button does not appear, the _Transcription_ options say so, and the log records why.
*   The transcript is made from the audio played by your device. A participant whose voice does not come out of your speakers or headphones, for example someone in the same room, is transcribed only as far as your microphone picks them up, and is labeled _Me_.
*   Speaker identification works best with a few clearly distinct voices. Similar voices, many participants or poor call quality can lead to speakers being merged or split.
*   Accuracy is lower for languages other than English, and the model can switch to the wrong language for short passages.
*   Transcribing uses a noticeable amount of processor time and memory, especially with the _High accuracy_ model.