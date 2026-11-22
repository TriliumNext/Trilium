# Writing changelog entries

The format of an entry (its `type`, `area`, `closes`, `notable`) is in `.changelog/README.md`. This
page is about the text: a release note is read by users who have not seen the pull request, so an
entry says what changed for them, in as few words as that takes.

## The register

- **Plain, not dramatic.** State the change and its effect. Don't stage a "before" scene ("a wait in
  front of an empty window"), and don't oversell ("finally", "blazing"). "Trilium now starts
  noticeably faster." is the tone.
- **What the user sees, not how it was built.** Leave out modules, chunks, requests, lazy loading,
  the layout's foundation. A sentence that explains the architecture usually reduces to its effect:
  "the mobile layout was rebuilt on the same foundation as the desktop one, so phones get the same
  gain" is "This applies to phones too."
- **Short examples, or none.** A list such as "a dialog, a menu or a note type" reads as padding;
  one clause ("loads the rest only once you use it") says the same.
- **A fix names the symptom once, not every case that triggers it.** "Shared notes ignored a
  `#shareCredentials` password inherited from a note outside the share." is the entry; "…when it
  came from a template, an `~inherit` target or a parent outside the share" spells out cases the
  commit body already lists. Aim for one line of about 15 words.
- **No trigger conditions either.** Drop the "when …" clause that says under which settings or
  state the bug showed: "The font previews in the Fonts settings were drawn at the wrong size.",
  not "…larger or smaller than the text they set when the document font size was not 100%."

## Numbers

A highlight about speed or size needs a number, and the number has to mean something to the
reader.

- **Only differences a person feels.** A third of a second against a tenth is a large ratio and a
  small experience; leave it out. Prefer the seconds saved where they are long (a slow device, a
  large database), and a rounded percentage where they are short ("about 30% sooner").
- **No implementation metrics.** Request counts, bytes transferred and long-task time belong in the
  commit body, with the method and the raw medians.
- **No baseline the reader cannot know.** "A CPU four times slower" begs "slower than what?".
  Name the condition by what it stands for: "simulating a slower device on a 20 Mbit/s connection".
- **Not where it was measured.** "Measured on a server" tells the reader nothing about their own
  setup; the commit body records the setup.
- **Measured, not estimated.** Time both versions on the same machine, interleaved, and take the
  median of several runs; round in the entry, keep the exact values in the commit body.

## Scope

- **One theme per highlight.** A side effect worth telling (a note type that loads less, a new
  error screen) goes in its own `improvement` or `fix` entry with its `area`, not in a last
  paragraph of the highlight.
- **Check every claim about the old behavior** against `main` or the last release before writing
  it. "It used to load every dialog" is wrong if dialogs were already loaded on demand; when a
  claim can't be confirmed, drop it.
- **Length follows the feature.** A new feature with many commands can need several paragraphs (the
  Vim mode highlight); a performance gain fits in two short ones: what changed, then the numbers.

## The overview

The `type: overview` entry opens the release note in the maintainer's voice (`.changelog/README.md`,
"The overview"). The register above applies, and so do these:

- **Open with the content.** The first sentence is the first change worth telling ("Links can now
  point at a heading…"), not a framing sentence such as "This release is about…" or "This is the
  release where…".
- **No stock phrases.** Leave out "of their own", "next to", "a whole new", "under the hood" and
  the like; say the fact directly ("text notes have a Vim mode", not "a Vim mode of their own").
- **No technical detail.** Not what a feature is built on ("the same engine as code notes") or how
  it works ("the tree comes first, the rest loads later"); only what the user can now do or notice.
- **Don't repeat the sections below.** Breaking changes, compatibility notes and notices have their
  own place in the note; the overview does not point to them.

## Before committing

Read the entry as a user who skims the release note: every sentence should survive the questions
"so what?" and "compared to what?". Then run `pnpm changelog:lint`.
