# Flashcards
Flashcards let you review notes with spaced repetition. Trilium schedules reviews with FSRS, the same family of scheduler used by modern flashcard applications.

## Creating flashcards

A flashcard is created from a normal note. Use the note actions menu or command palette to add flashcards to the current note. The note title becomes the front of a basic card, and the note body becomes the answer.

For fill-in-the-blank cards, use cloze deletions inside text notes:

```text
The capital of France is {{c1::Paris}}.
```

Use the cloze toolbar button to wrap selected text. Repeated `c1`, `c2`, and later numbers become separate cloze cards for the same note.

## Reviewing cards

Open flashcards from the launcher bar, command palette, or note actions. The review dialog shows due cards first, then learning cards, then new cards.

After revealing the answer, choose one of the ratings:

*   **Again** when the answer was wrong or forgotten.
*   **Hard** when the answer was remembered with difficulty.
*   **Good** when the answer was remembered correctly.
*   **Easy** when the answer was obvious.

Keyboard shortcuts are available in the dialog: press <kbd>Space</kbd> to reveal, number keys to rate, and <kbd>U</kbd> to undo the last review.

## Decks and filtered decks

Decks are ordinary notes that contain flashcards. The deck browser shows due, new, learning, review, suspended, and total counts.

Filtered decks are based on saved searches. They do not move cards into a separate storage location; membership is recalculated from the search query. Use them for temporary study sets such as a topic, tag, or branch of notes.

## Scheduling settings

Flashcard settings are in Options -> Flashcards. Defaults work for most users. Advanced users can adjust:

*   requested retention,
*   maximum interval,
*   learning and relearning steps,
*   daily new and review limits,
*   day rollover hour,
*   FSRS weights.

If several devices sync the same database, reviews are scheduled by the backend that receives the review. Conflict protection prevents duplicate submissions from overwriting newer review state.

## Suspending and leeches

Suspended cards stay out of the review queue until resumed. Cards with repeated lapses can become leeches and may be suspended automatically. The leech section helps find and resume those cards later.

## Import, export, and portability

Trilium can import Anki `.apkg` packages. Imported cards become Trilium notes and flashcards; referenced media is imported as attachments when possible. Scheduling state and review history are preserved as far as Trilium's FSRS scheduler can use them.

Flashcard data is included in normal Trilium database backups and sync. Flashcard scheduling state and review history are also included in Trilium JSON export/import. Use **Export .apkg** in Options -> Flashcards when you need a package that other flashcard applications can read.

## Privacy

Review history records what was reviewed, when it was reviewed, the selected rating, and scheduler state. This data syncs with the rest of your Trilium database. Treat flashcard history like normal note data when choosing sync servers, backups, and exports.
