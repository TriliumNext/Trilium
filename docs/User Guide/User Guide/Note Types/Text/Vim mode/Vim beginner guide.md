# Vim beginner guide
Vim is a text editor built around the keyboard. Trilium can imitate the way it works, in text notes and in code notes, and this is called Vim mode. This page explains the idea behind it, what each mode does and which keys to learn first. It applies to both kinds of notes, and where they differ, the text says so.

> [!NOTE]
> Vim mode is optional and off by default. Nothing on this page applies until it is turned on, see _Turning it on_ below.

## How the keys are written

On these pages, a command is written as the keys to press, one after another. `dd` means pressing `d` twice, and `ciw` means pressing `c`, then `i`, then `w`. The keys are not held down together.

Keys that are held down together are written with a plus sign, such as <kbd>Ctrl</kbd>+<kbd>R</kbd>. Capital letters matter: `A` is typed with <kbd>Shift</kbd> and does something else than `a`.

## What is Vim?

[Vim](https://www.vim.org/) is a popular text editor. Its most distinctive feature is that it is a **modal** editor. In most editors, pressing a letter always types that letter. In Vim, what a key does depends on the mode the editor is in: in one mode the letters type text, in another the same letters are commands that move the cursor, delete a word or copy a line.

Trilium does not contain Vim itself. It imitates Vim's keys inside its own editors, so your notes stay ordinary Trilium notes.

## Why use it?

*   **The hands stay on the keyboard.** Moving, selecting, copying and searching are all done with the letter keys, without reaching for the mouse or the arrow keys. The mouse keeps working as usual.
*   **Commands combine.** A few keys are learned once and then put together: `d` means delete and `w` means a word, so `dw` deletes a word.
*   **Changes can be repeated.** `.` repeats the last change, and a number in front of a command runs it that many times.
*   **Much of it carries over.** Many of the motions and editing commands also work in Vim itself and in the Vim modes of other editors. Trilium has some commands of its own, and text notes differ in places because they hold rich text, not plain text files.

Vim mode can take some time to get used to. If it does not suit you, turning the option off brings the regular editor back.

## Turning it on

Text notes and code notes each have their own option, and both apply to the current device only:

*   For text notes, go to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ → _Features_ and turn on _Vim mode_. See <a class="reference-link" href="../Vim%20mode.md">Vim mode</a> for its settings.
*   For code notes, go to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Code Notes_ → _Editor_ and turn on _Vim keybindings_.

## The modes

A mode decides what the keyboard does. There are five main modes:

| Mode | What the keys do | How to enter it |
| --- | --- | --- |
| Normal | Run commands: move, delete, copy, paste. | <kbd>Esc</kbd> from any other mode |
| Insert | Type text, as in a regular editor. | `i` |
| Visual | Select text. | `v` for characters, `V` for whole lines |
| Replace | Type over the existing text. | `R` |
| Command line | Type a command by its name, or a text to search for. | `:` for a command, `/` or `?` to search |

Vim also has Visual Block mode, which selects a rectangle of text across several lines. It is not supported at present. In text notes, <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes in Normal and Visual mode, and while typing too, unless the _Vim keys in Insert mode_ setting is on. In code notes, <kbd>Ctrl</kbd>+<kbd>V</kbd> or <kbd>Ctrl</kbd>+<kbd>Q</kbd> does start the mode, but the selection stays on one line, so it does not work as a rectangle.

### Normal mode

Normal mode is the mode a note opens in, and the one you return to between two edits. The letter keys do not type here. Each one is a command: `j` moves down a line, `x` deletes a character, `u` undoes the last change.

This is the part that feels strange at first. The idea is that most of the time spent in a note goes to reading, moving around and changing existing text, not to typing new text, so the keys under your fingers are given to those tasks.

There is one exception to where a note starts: the text notes that were already open when Vim mode was turned on are in Insert mode, so that typing keeps working. Press <kbd>Esc</kbd> to go to Normal mode.

### Insert mode

Insert mode is the editor you already know: the keys type text. Press `i` in Normal mode to enter it, and <kbd>Esc</kbd> to leave it.

In text notes, the regular editing features stay available in Insert mode, such as the formatting shortcuts, slash commands and toolbars. A few <kbd>Ctrl</kbd> shortcuts have a Vim meaning there: see <a class="reference-link" href="../Vim%20mode.md">Vim mode</a>.

> [!TIP]
> There are several ways into Insert mode, depending on where you want to type: `i` before the cursor, `a` after it, `A` at the end of the line, and `o` on a new line below.

### Visual mode

Visual mode selects text. Press `v`, then move the cursor: the selection follows it. Then press a key to act on the selection, for example `d` to delete it or `y` to copy it. `V` selects whole lines in the same way. <kbd>Esc</kbd> leaves Visual mode without changing anything.

### Replace mode

In Replace mode, each character you type takes the place of the one under the cursor, instead of being added before it. Press `R` to enter it and <kbd>Esc</kbd> to leave it.

### The command line

Some commands are typed by name. Pressing `:` in Normal mode opens the command line, where you type the command and press <kbd>Enter</kbd>. For example, `:sort` sorts lines. Pressing `/` opens it for a search instead, and `?` for a search backward. <kbd>Esc</kbd> closes it without running anything.

In text notes, the command line opens in the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Status bar</a>, where the breadcrumb is. In code notes, it opens at the bottom of the editor.

### Which mode am I in?

*   In text notes, the status bar shows the mode: `NORMAL`, `INSERT`, `VISUAL`, `VISUAL LINE` or `REPLACE`.
*   In both kinds of notes, the cursor tells the mode as well. In Normal and Visual mode, it is a block that covers a character. In Insert mode, the block is gone and the ordinary thin caret shows in its place.

## A first session

This exercise is meant to give a feel for going between Normal and Insert mode, not to teach keys by heart. Use a note that you can experiment in, such as a new note or a copy of an existing one, and then:

1.  Press `i` and type a few words. You are in Insert mode.
2.  Press <kbd>Esc</kbd>. You are back in Normal mode, and the cursor becomes a block.
3.  Move the cursor with `h` (left), `j` (down), `k` (up) and `l` (right).
4.  Press `x` to delete the character under the cursor, and then `u` to undo that.
5.  Press `dd` to delete the whole line, and `u` to bring it back.
6.  Press `A`. The cursor jumps to the end of the line, in Insert mode. Type something, and then press <kbd>Esc</kbd>.
7.  Press `v`, move a few characters with `l`, and then press `d`. The selected text is deleted.

That is the whole cycle: Normal mode to move and change, Insert mode to type, <kbd>Esc</kbd> to go back.

## Moving the cursor

| Keys | Moves to |
| --- | --- |
| `h` `j` `k` `l` | Left, down, up, right. The arrow keys work as well. |
| `w` / `b` | The next / previous word. |
| `0` / `$` | The start / end of the line. |
| `gg` / `G` | The first / last line of the note. |
| `/text` and <kbd>Enter</kbd> | The next place where "text" appears. `n` goes to the following one. |

In a text note, a line is a whole paragraph, even when it takes several lines on the screen. So `j` moves to the next paragraph, and `0` and `$` go to its start and end.

## Changing text

| Keys | What it does |
| --- | --- |
| `x` | Deletes the character under the cursor. |
| `dd` | Deletes the line. |
| `cw` | Deletes the rest of the word and enters Insert mode, to type a new one. |
| `r` and a character | Replaces the character under the cursor with that one. |
| `u` | Undoes the last change. |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Redoes what was undone. |
| `.` | Repeats the last change. |

## Combining keys

Most commands of Vim are made of two parts, like a short sentence: what to do, and what to do it to.

*   The first part is an **operator**: `d` deletes, `c` changes (deletes, then lets you type), `y` copies.
*   The second part is a **motion**, which is any key that moves the cursor: `w` for a word, `$` for the end of the line, `G` for the end of the note.

| Keys | Meaning |
| --- | --- |
| `dw` | Delete up to the next word. |
| `d$` | Delete up to the end of the line. |
| `cw` | Change the rest of the word. |
| `yG` | Copy from here to the end of the note. |

Two more ideas complete the picture:

*   **A number repeats.** `3w` moves three words forward, and `3dd` deletes three lines.
*   **Text objects name a thing around the cursor.** `iw` is "the word the cursor is in" and `ip` is "this paragraph". So `diw` deletes the word under the cursor, wherever the cursor is in it, and `yip` copies the paragraph.

Since an operator can be combined with almost any motion and text object, a handful of keys gives a large number of commands, and there is no need to memorize them one by one.

## Copying and pasting

Vim has its own words for these: to **yank** is to copy, and to **put** is to paste.

*   `yy` yanks the current line, and `yw` yanks a word.
*   `p` puts what was yanked after the cursor, and `P` before it.
*   Deleted text can be put as well: `dd` followed by `p` moves a line down.
*   In Visual mode, `y` yanks the selection.

Yanked text is kept in a **register**, which is Vim's own storage and is separate from the clipboard of your computer. To use the clipboard, type `"+` in front of the command: `"+yy` copies the line to the clipboard, and `"+p` pastes from it. In text notes, <kbd>Ctrl</kbd>+<kbd>C</kbd> and <kbd>Ctrl</kbd>+<kbd>V</kbd> also keep working with the clipboard.

The clipboard is also the way to carry text between a text note and a code note, since the two kinds of notes do not share their registers: `"+y` in one, `"+p` in the other.

## Searching and replacing

*   To search, press `/`, type the text and press <kbd>Enter</kbd>. `n` goes to the next match and `N` to the previous one.
*   To search for the word under the cursor, press `*`.
*   To replace in the current line, type `:s/old/new/`.
*   To replace everywhere in the note, type `:%s/old/new/g`.

> [!NOTE]
> The text to search for is read as a regular expression, in the syntax of JavaScript. Letters, digits and spaces mean themselves, but characters such as `.`, `*`, `(` and `[` have a special meaning. To search for one of them as it is, put a `\` before it: `/1\.5` finds "1.5".

## Getting unstuck

*   **Not sure what is going on?** Press <kbd>Esc</kbd>, twice if needed. It cancels a command that is half typed and returns to Normal mode.
*   **The keys do not type.** The editor is in Normal mode. Press `i`.
*   **Typing changed the note in strange ways.** The editor was in Normal mode and the letters ran as commands. Press <kbd>Esc</kbd>, then press `u` once and look at the result. Repeat only as long as there is something left to take back, since each further `u` also undoes an earlier edit of yours. <kbd>Ctrl</kbd>+<kbd>R</kbd> redoes a step that went too far.
*   **Vim mode is in the way.** Turn the option off. Your notes are not affected.

> [!TIP]
> In text notes, the status bar helps while you learn: it shows the keys of the current mode, and after a short pause in the middle of a command, the keys that can follow. To see every key of the mode, click the mode in the status bar or press <kbd>Alt</kbd>+<kbd>F1</kbd>.

## Next steps

*   The cheat sheet in <a class="reference-link" href="../Vim%20mode.md">Vim mode</a> lists the most used keys, including the ones that Trilium adds for text notes.
*   The <a class="reference-link" href="Vim%20full%20reference.md">Vim full reference</a> lists the keys and commands that are supported.
*   To practice, [OpenVim](https://openvim.com/) is a short interactive tutorial that runs in the browser. Vim itself comes with a longer one, started with the `vimtutor` command. Both teach the real Vim: most of it carries over, but not every command of Vim exists in Trilium.