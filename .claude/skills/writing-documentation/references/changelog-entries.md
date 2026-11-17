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

## Before committing

Read the entry as a user who skims the release note: every sentence should survive the questions
"so what?" and "compared to what?". Then run `pnpm changelog:lint`.
