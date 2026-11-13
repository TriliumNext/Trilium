# Vim mode
> [!TIP]
> New to Vim? Start with the <a class="reference-link" href="Vim%20mode/Vim%20beginner%20guide.md">Vim beginner guide</a>, which explains what the modes are and which keys to learn first.

Vim mode brings Vim-style modal editing to text notes: the motions, operators and commands of the [Vim](https://www.vim.org/) text editor, in Trilium's own editor. It understands the structure of rich text: a paragraph, a heading, a list item or a table cell is a line, and so is an image or an included note.

The most used keys are in the _Cheat sheet_ below, and all of them in the <a class="reference-link" href="Vim%20mode/Vim%20full%20reference.md">Vim full reference</a>.

## Enabling Vim mode

1.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ → _Features_.
2.  Turn on _Vim mode_.

The option applies to the current device only, so repeat these steps on each device where you want Vim mode. It takes effect at once, without a reload. Code notes have an option of their own: <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Code Notes_ → _Editor_ → _Vim keybindings_.

Once Vim mode is on:

*   Newly opened text notes start in Normal mode: press `i` to type, and <kbd>Esc</kbd> to return to the commands.
*   The notes that were already open when Vim mode was turned on switch to Insert mode, so you can continue typing.
*   In Insert mode, the regular editor stays available, with its formatting, slash commands, Markdown-like formatting and toolbars. A few shortcuts follow Vim there too, see _Shortcuts that change in the editor_ below.

### Where Vim mode shows

Vim mode uses two places of the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Status%20bar.md">Status bar</a>, at the bottom of the window:

*   The **mode indicator**, next to the other indicators of the status bar, shows the current mode: `NORMAL`, `INSERT`, `VISUAL`, `VISUAL LINE` or `REPLACE`. Beside it appear the keys of a command that is not complete yet, short messages and the macro being recorded.
*   The area of the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Breadcrumb.md">Breadcrumb</a> is used for two things: the key hints, described below, and the command line, which opens there when you press `:`, `/` or `?`.

<a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Zen%20mode.md">Zen mode</a> keeps both.

## Settings

The settings are in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ → _Features_. The last three appear below _Vim mode_ once it is turned on. _Vim mode_ itself is kept per device, while the other three are synchronized.

| Setting | Default | Applies to | What it does |
| --- | --- | --- | --- |
| _Vim mode_ | Off | This device | Turns Vim mode on in text notes. |
| _Key hints_ | On | All your devices | Shows the keys of the current mode, the keys that can follow a command and the suggestions of the command line. See _Key hints_ below. |
| _Vim keys in Insert mode_ | Off | All your devices | Makes <kbd>Ctrl</kbd>+<kbd>U</kbd>, <kbd>Ctrl</kbd>+<kbd>E</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd>, <kbd>Ctrl</kbd>+<kbd>K</kbd>, <kbd>Ctrl</kbd>+<kbd>V</kbd> and <kbd>Ctrl</kbd>+<kbd>A</kbd> follow Vim while typing. When off, they keep the meaning the editor gives them, such as underline for <kbd>Ctrl</kbd>+<kbd>U</kbd> and paste for <kbd>Ctrl</kbd>+<kbd>V</kbd>. |
| _Startup commands_ | Empty | All your devices | Runs commands when Vim mode starts, mostly to set up key mappings. |

### Startup commands

Write one command per line, as it would be typed after `:`. A line that starts with `"` is a comment.

```
" Leave Insert mode by typing jk
imap jk <Esc>
" Make Y yank to the end of the line
nmap Y y$
```

When you edit the list, the commands run again as soon as you leave the field, and their mappings replace those of the previous list. Changing the other settings does not run them again. Only the commands of Vim mode are understood, so a `.vimrc` file made for Vim does not work as it is.

### Vim mode for a single note

To decide for one note, whatever the option says, add a [label](../../Advanced%20Usage/Attributes/Labels.md) to it:

*   `#vimMode` turns Vim mode on in that note.
*   `#vimMode=false` keeps that note in the regular editor.

The label can be inherited, so one label can cover a whole subtree. A label set on the note itself wins over an inherited one: with an inheritable `#vimMode` on a parent note, a child note that has `#vimMode=false` stays in the regular editor.

## Key hints

Key hints help while you learn, and can be turned off once the keys are familiar. They show in the status bar, in the area of the breadcrumb:

*   In Normal and Visual mode, the most used keys of the mode take the place of the breadcrumb. To switch between the keys and the breadcrumb, press <kbd>Esc</kbd> in Normal mode. This is the last thing <kbd>Esc</kbd> does: when something else applies, such as search highlights to clear, that happens first and it takes another press. See _The Esc key_ below.
*   After a pause in the middle of a command, such as after `d` or `g`, the keys that can follow are shown.
*   The command line suggests the commands that match what is typed, and <kbd>Tab</kbd> or the arrow keys complete them. The search prompt tells how the pattern is read.
*   To see every key of the current mode, click the mode indicator or press <kbd>Alt</kbd>+<kbd>F1</kbd>.

To turn the hints off, use the _Key hints_ setting or type `:set nohints`. `:set hints` turns them back on.

## Cheat sheet

These are the keys and commands used most. Keys typed one after another are written together, such as `dd`. Unless stated otherwise, they are typed in Normal mode.

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1">
<div class="trilium-multicolumn-column">

### Modes

*   `i` / `a`: type before / after the cursor.
*   `I` / `A`: type at the start / end of the line.
*   `o` / `O`: open a line below / above and type.
*   `v` / `V`: select characters / whole lines.
*   `R`: type over the existing text.
*   <kbd>Esc</kbd>: return to Normal mode.

### Moving

*   `h` `j` `k` `l`: left, down, up, right.
*   `w` / `b` / `e`: next word, previous word, end of the word.
*   `0` / `^` / `$`: start of the line, first character, end of the line.
*   `gg` / `G`: first / last line of the note. `12G` goes to line 12.
*   `{` / `}`: previous / next block.
*   `f` and a character: jump to that character in the line. `;` repeats the jump.
*   `%`: go to the matching bracket.
*   <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Ctrl</kbd>+<kbd>U</kbd>: half a page down / up.
*   <kbd>Ctrl</kbd>+<kbd>O</kbd> / <kbd>Ctrl</kbd>+<kbd>I</kbd>: back / forward through the places you jumped from.

### Editing

*   `x`: delete the character under the cursor.
*   `dd` / `dw` / `D`: delete the line, the word, the rest of the line.
*   `cc` / `cw` / `C`: change the line, the word, the rest of the line.
*   `ciw`: change the word under the cursor, wherever the cursor is in it.
*   `r` and a character: replace one character.
*   `J`: join the next line to this one.
*   `>>` / `<<`: indent / outdent the line.
*   `~`: switch between upper and lower case.
*   `u` / <kbd>Ctrl</kbd>+<kbd>R</kbd>: undo / redo.
*   `.`: repeat the last change.
*   A number repeats a command: `3dd` deletes three lines, `2w` moves two words.

</div>
<div class="trilium-multicolumn-column">

### Copying and pasting

*   `yy` / `yw` / `y$`: yank (copy) the line, the word, the rest of the line.
*   `p` / `P`: put (paste) after / before the cursor.
*   `"ayy` / `"ap`: yank the line into the register `a` / put from it.
*   `"+y` / `"+p`: copy to / paste from the system clipboard.

Yanked text keeps its formatting, such as bold, links and colors.

### Selecting

*   `v` / `V`: start selecting characters / lines. Any motion extends the selection.
*   `iw`, `ip`, `i"`, `i(`: select a word, a block, the text inside quotes or parentheses. `a` in place of `i` also takes what surrounds it.
*   `y` / `d` / `c`: yank, delete or change the selection.
*   `>` / `<`: indent / outdent the selected lines.
*   `o`: jump to the other end of the selection.
*   `gv`: select the previous selection again.

### Searching and replacing

*   `/text` / `?text`: search forward / backward, then press <kbd>Enter</kbd>.
*   `n` / `N`: next / previous match.
*   `*` / `#`: search for the word under the cursor, forward / backward.
*   `:s/old/new/`: replace in the current line.
*   `:%s/old/new/g`: replace everywhere in the note. Add `c` to confirm each match.
*   `:noh`: clear the search highlights.

### Trilium-specific features

*   `:w`: save the note now. Trilium also saves by itself.
*   `:q` or `ZZ`: close the tab of the note, or its split.
*   `gf`: follow the link under the cursor.
*   `]]` / `[[`: go to the next / previous heading.
*   `za`: collapse or expand the heading, list item or collapsible block at the cursor.
*   `:sort`: sort the selected paragraphs or list items, or the ones around the cursor.
*   `:ck bold`: run a command of the text editor by its name, here on the selection.
*   `i` or `a` on an image or an included note: edit its caption or its content.
*   <kbd>Alt</kbd>+<kbd>F1</kbd>: list every key of the current mode.

</div>
</div>

For the other keys and commands, see <a class="reference-link" href="Vim%20mode/Vim%20full%20reference.md">Vim full reference</a>.

## How Vim reads a text note

Vim works with lines, and a text note has none of its own. This is how the two fit together:

*   Each paragraph, heading, paragraph of a list item, paragraph of a table cell and line of a code block is one line, however many lines it takes on the screen. This is sometimes called a _logical line_, as opposed to a _screen line_. `dd`, `yy`, `j` and `k` act on logical lines, while `gj` and `gk` move by screen line.
*   An image, a diagram, a horizontal rule or an included note is also one line: `j` and `k` stop on it and `dd` deletes it. `i` or `a` enters its caption or its content. To leave an included note, press <kbd>Esc</kbd> in its Normal mode, `k` on its first line or `j` on its last line.
*   `o` and `O` add what <kbd>Enter</kbd> would add at that place, such as a paragraph, a list item or a code line. `J` joins lines the way <kbd>Backspace</kbd> does. `>>` and `<<` change the level of a list item or the indentation of a paragraph.
*   `{`, `}`, `ip` and `ap` work with blocks instead of blank lines: a paragraph, a list item, a quote, a table cell, a code block. On a heading, `ap` is the heading together with its section.
*   In a table, `h` and `l` stay inside the cell, and `j` and `k` move down and up the column.
*   A collapsed heading or list item counts as one line for `j` and `k`. Searching also looks inside it, and expands the one that holds a match.
*   Registers are shared by all text notes, but not with code notes. To carry text between the two, use the clipboard register `"+`.

## Shortcuts that change in the editor

Vim uses some of the <kbd>Ctrl</kbd> shortcuts of Trilium. While the cursor is in a text note, Vim's meaning wins, as it already does in code notes. The last column shows Insert mode with the _Vim keys in Insert mode_ setting off, which is the default:

| Shortcut | Without Vim mode | In Normal and Visual mode | In Insert mode |
| --- | --- | --- | --- |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Reload the app (<kbd>F5</kbd> still does) | Redo | Insert the content of a register |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Create a note after the current one | Go back to the previous jump | Run one Normal-mode command |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Create a child note | Move up a line, as `k` | Nothing |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Search in note (desktop app) | Scroll a page down | Unchanged |
| <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>Ctrl</kbd>+<kbd>I</kbd>, <kbd>Ctrl</kbd>+<kbd>U</kbd> | Bold, italic, underline | Scroll a page up, go forward to the next jump, scroll half a page up | Unchanged |
| <kbd>Ctrl</kbd>+<kbd>A</kbd>, <kbd>Ctrl</kbd>+<kbd>X</kbd> | Select all, cut | Increase, decrease the number at the cursor | Unchanged |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo, redo | The same as `u` and <kbd>Ctrl</kbd>+<kbd>R</kbd> | Unchanged |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> | Close the tab | Nothing | Delete the word before the cursor |
| <kbd>Ctrl</kbd>+<kbd>T</kbd>, <kbd>Ctrl</kbd>+<kbd>D</kbd> | Open a new tab, nothing | Unchanged, scroll half a page down | Indent, outdent the line |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Copy | Copy the selection and leave Visual mode. With nothing selected, the same as <kbd>Esc</kbd> | Copy the selection. With nothing selected, leave Insert mode |
| `/` and `:` | Slash commands and emoji completion | Search and the command line | Unchanged |

With _Vim keys in Insert mode_ turned on, six more shortcuts follow Vim while typing. In Normal and Visual mode, the setting changes nothing.

| Shortcut | In Insert mode, setting off | In Insert mode, setting on |
| --- | --- | --- |
| <kbd>Ctrl</kbd>+<kbd>U</kbd> | Underline | Delete from the cursor to the start of the line |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | Nothing | Insert the character that is below the cursor |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo | Insert the character that is above the cursor |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Create a link | Start a digraph, a character typed as two keys |
| <kbd>Ctrl</kbd>+<kbd>V</kbd> | Paste | Insert the next key as it is |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Select all | Insert the last inserted text again |

To paste while the setting is on, press <kbd>Esc</kbd> first: in Normal and Visual mode, <kbd>Ctrl</kbd>+<kbd>V</kbd> always pastes.

*   Shortcuts with <kbd>Alt</kbd>, with <kbd>Ctrl</kbd>+<kbd>Shift</kbd> or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>, and the function keys keep their meaning in every mode, apart from <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> above. So do the shortcuts that Vim does not use, such as <kbd>Ctrl</kbd>+<kbd>L</kbd> for a link to a note. <kbd>Ctrl</kbd>+<kbd>K</kbd> for a link is one of them too, except in Insert mode with the setting above turned on.
*   On macOS, the shortcuts of Trilium use <kbd>⌘</kbd> and those of Vim use <kbd>Ctrl</kbd>, so nothing is taken over. <kbd>⌘</kbd>+<kbd>Z</kbd> and <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> undo and redo.
*   In a browser on Windows and Linux, <kbd>Ctrl</kbd>+<kbd>W</kbd>, <kbd>Ctrl</kbd>+<kbd>T</kbd> and <kbd>Ctrl</kbd>+<kbd>N</kbd> always belong to the browser.

### The Esc key

<kbd>Esc</kbd> does one thing per press, the first of these that applies:

1.  Closes what is open: the command line or the search prompt, a popup such as the link balloon, a completion list or the list of keys.
2.  Cancels the keys typed so far of a command.
3.  Leaves Visual or Insert mode.
4.  Clears the search highlights.
5.  In an included note, returns to the note around it.
6.  Switches between the key hints and the breadcrumb, when the key hints are on.

So with a link balloon open in Insert mode, the first press closes the balloon and the second one leaves Insert mode. <kbd>Ctrl</kbd>+<kbd>[</kbd> does the same as <kbd>Esc</kbd>.

## Limitations

*   Vim mode imitates Vim, it does not run Vim itself. Plugins and scripts made for Vim are not available, and some of its commands are missing: see _Not supported_ in the <a class="reference-link" href="Vim%20mode/Vim%20full%20reference.md">Vim full reference</a>.
*   Vim mode is not available in the mobile layout, and read-only notes have no modes.
*   Visual Block mode is not supported. <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes, except in Insert mode when _Vim keys in Insert mode_ is on.
*   Search patterns are JavaScript regular expressions, not Vim's own, and a match cannot span more than one line.
*   `:q!` and `ZQ` only show a message: notes are saved as you type, so there is nothing to discard.
*   A code note that is included in a text note follows the _Vim keybindings_ option of code notes.

## See also

*   <a class="reference-link" href="Vim%20mode/Vim%20beginner%20guide.md">Vim beginner guide</a>, for the modes and the first keys to learn.
*   <a class="reference-link" href="Vim%20mode/Vim%20full%20reference.md">Vim full reference</a>, for all the keys and commands.