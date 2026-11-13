# Vim full reference
This page lists the keys and commands of Vim mode, for text notes and for <a class="reference-link" href="../../Code.md">Code</a> notes. Unless a row says otherwise, it applies to both. For an introduction, see <a class="reference-link" href="Vim%20beginner%20guide.md">Vim beginner guide</a>; for the settings, the keys used most and how text notes are read as lines, see <a class="reference-link" href="../Vim%20mode.md">Vim mode</a>.

## Reading the tables

*   Keys typed one after another are written together: `dd` is `d` pressed twice. Keys held together are written with a plus sign: <kbd>Ctrl</kbd>+<kbd>R</kbd>.
*   `{motion}` stands for any key from _Motions_, `{char}` for any character, `{count}` for a number and `{register}` for the name of a register.
*   Unless a section says otherwise, the keys are typed in Normal mode.
*   In a browser on Windows and Linux, <kbd>Ctrl</kbd>+<kbd>W</kbd>, <kbd>Ctrl</kbd>+<kbd>T</kbd> and <kbd>Ctrl</kbd>+<kbd>N</kbd> are kept by the browser, which closes a tab or opens a tab or a window, so they never reach Trilium. The rows that use them say so. The desktop app and macOS are not affected.

A badge at the end of a description tells where the row applies:

*   **Text notes only**: not available in code notes.
*   **Code notes only**: not available in text notes.
*   **Trilium-exclusive**: a command introduced by Trilium, or a command of Vim whose behavior is adapted to Trilium.

### Available, but not guaranteed

In text notes, most keys and commands are adapted to rich text and tested with it. The ones below work as they do in Vim on plain text, but they have been tested less with the structures of a text note, such as tables, images and nested lists. If one of them makes an unexpected change to the text, press `u` to undo it, and check the result before going on. The app lists them under the same name, in the list of keys and in the command line.

*   Macros: `q` and `@`.
*   Registers with a name: `"a` to `"z`, the numbered ones and the special ones. This does not include the register used when none is named, or the clipboard registers `"+` and `"*`.
*   Marks: `m`, `'` and `` ` ``.
*   These commands of the command line: `:g`, `:v`, `:normal`, `:d`, `:y`, `:pu`, `:j`, `:registers`, `:marks`, `:delmarks`, and the key mappings (`:map` and its variants, `:unmap`, `:mapclear`).

The sections below say so again where it applies. Code notes have no such distinction.

## Help

| Keys | Action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>F1</kbd> | List the keys of the current mode. While a command is being typed, the keys that can follow it; in the command line, its keys and commands. A click on the mode in the status bar opens the same list. **Trilium-exclusive** **Text notes only** |

## Counts and repeating

| Keys | Action |
| --- | --- |
| `{count}` before a command | Runs the command that many times: `3w`, `5dd`, `2d3w`. |
| `.` | Repeats the last change. |
| `u` | Undoes the last change. |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Redoes the change that was undone. |

## Changing mode

| Keys | Action |
| --- | --- |
| `i` / `a` | Insert before / after the cursor. On an image or an included note of a text note, enters its caption or its content. |
| `I` / `A` | Insert before the first non-blank character / at the end of the line. |
| `gI` | Insert at the very start of the line. |
| `gi` | Insert where the last change ended. |
| `o` / `O` | Open a new line below / above and insert. In text notes, the new line is what <kbd>Enter</kbd> would add there: a paragraph, a list item or a code line. |
| `s` | Delete the character under the cursor and insert. |
| `S` | Clear the line and insert. |
| `R` | Enter Replace mode, where typed characters overwrite the existing ones. <kbd>Backspace</kbd> restores them. |
| <kbd>Insert</kbd> | Enter Insert mode. In Insert mode, switches between Insert and Replace mode. |
| `v` | Enter Visual mode, which selects characters. |
| `V` | Enter Visual Line mode, which selects whole lines. |
| `gv` | Select the previous selection again. |
| `:` | Open the command line. |
| <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>[</kbd> | Return to Normal mode, or cancel the keys typed so far. |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | The same as <kbd>Esc</kbd>. In text notes, it copies when something is selected. |

## Motions

A motion moves the cursor. After an operator, it tells how much text the operator takes. In Visual mode, it extends the selection.

### Characters and lines

| Keys | Moves to |
| --- | --- |
| `h` / `l` | The character on the left / right, within the line. Also <kbd>←</kbd> or <kbd>Backspace</kbd>, and <kbd>→</kbd> or <kbd>Space</kbd>. |
| `j` / `k` | The line below / above. Also <kbd>↓</kbd> and <kbd>↑</kbd>. In a table of a text note, they move down / up the column. |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> / <kbd>Ctrl</kbd>+<kbd>P</kbd> | The same as `j` / `k`. <kbd>Ctrl</kbd>+<kbd>N</kbd> does not work in a browser on Windows and Linux. |
| `gj` / `gk` | The screen line below / above, inside a line that wraps. |
| `0` or <kbd>Home</kbd> | The start of the line. |
| `^` | The first non-blank character of the line. |
| `$` or <kbd>End</kbd> | The end of the line. |
| `g0` or `g^` / `g$` | The start / end of the screen line. |
| `{count}\|` | The column with that number. |
| `+` or <kbd>Enter</kbd> / `-` | The first non-blank character of the next / previous line. |
| `_` | The first non-blank character of the current line. |

### Words and sentences

| Keys | Moves to |
| --- | --- |
| `w` / `b` | The start of the next / previous word. |
| `e` / `ge` | The end of the word / of the previous word. |
| `W` `B` `E` `gE` | The same, for words separated by spaces only, so that punctuation is part of the word. |
| `(` / `)` | The start of the previous / next sentence. |

### In the line

| Keys | Moves to |
| --- | --- |
| `f{char}` / `F{char}` | The next / previous `{char}` in the line. |
| `t{char}` / `T{char}` | Just before the next / just after the previous `{char}` in the line. |
| `;` / `,` | Repeat the last `f`, `F`, `t` or `T`, in the same / opposite direction. |
| `%` | The bracket that matches the one under the cursor: `()`, `[]` or `{}`. |
| `[(` / `])` | The parenthesis that opens / closes the pair around the cursor. |
| `[{` / `]}` | The brace that opens / closes the pair around the cursor. |

### Blocks and headings

| Keys | Moves to |
| --- | --- |
| `{` / `}` | The previous / next paragraph, which is separated by a blank line. In text notes, the previous / next block (a paragraph, a list item, a table, a quote and so on) at the nesting level of the cursor. |
| `[[` / `]]` | The previous / next heading. **Trilium-exclusive** **Text notes only** |
| `[]` / `][` | The line before the previous / next heading. **Trilium-exclusive** **Text notes only** |
| `[z` / `]z` | The heading / the last line of the section the cursor is in. **Trilium-exclusive** **Text notes only** |
| `zk` / `zj` | The previous / next heading. **Trilium-exclusive** **Text notes only** |

### The note and the screen

| Keys | Moves to |
| --- | --- |
| `gg` / `G` | The first / last line of the note. |
| `{count}G` or `{count}gg` | The line with that number. |
| `{count}%` | The line that many percent into the note. **Text notes only** |
| `H` / `M` / `L` | The top / middle / bottom line on the screen. |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> / <kbd>Ctrl</kbd>+<kbd>U</kbd> | Half a page down / up. |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>B</kbd> | A page down / up. Also <kbd>Page Down</kbd> and <kbd>Page Up</kbd>. |

## Scrolling

These keys scroll the note and leave the cursor on its line.

| Keys | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Scroll one line down / up. |
| `zz` / `zt` / `zb` | Scroll the line of the cursor to the middle / top / bottom of the screen. |
| `z.` / `z`<kbd>Enter</kbd> / `z-` | The same, and move the cursor to the first non-blank character. |

## Operators

An operator acts on the text that the motion or text object after it covers: `dw`, `c$`, `yap`. Typing the last key of an operator twice applies it to the line: `dd`, `yy`, `cc`, `>>`, `g~~`, `guu`, `gUU`. In Visual mode, an operator acts on the selection.

| Keys | Action |
| --- | --- |
| `d{motion}` | Delete. The deleted text goes to a register, so `p` can put it back. |
| `y{motion}` | Yank, which copies into a register. |
| `c{motion}` | Change: delete, then enter Insert mode. |
| `>{motion}` / `<{motion}` | Indent / outdent. In text notes, this changes the level of a list item or the indentation of a paragraph. |
| `g~{motion}` | Switch between upper and lower case. |
| `gu{motion}` / `gU{motion}` | Make lower case / upper case. |
| `g?{motion}` | Encode with ROT13. |
| `={motion}` | Indent the code again, by the rules of its language. `==` does it for the line. **Code notes only** |
| `gq{motion}` / `gw{motion}` | Wrap long lines at the text width, which is 80 characters unless `:set textwidth` changes it. `gw` leaves the cursor where it is. **Code notes only** |
| `gc{motion}` | Turn lines into comments, or back into code, in a language that has line comments. `gcc` does it for the line. **Code notes only** |

### Shorter forms

| Keys | The same as | Action |
| --- | --- | --- |
| `x` or <kbd>Delete</kbd> | `dl` | Delete the character under the cursor. In a text note, on an image or another object, deletes it. |
| `X` | `dh` | Delete the character before the cursor. |
| `D` | `d$` | Delete to the end of the line. |
| `C` | `c$` | Change to the end of the line. |
| `Y` | `yy` | Yank the line. |
| `s` | `cl` | Change the character under the cursor. |
| `S` | `cc` | Change the line. |
| `~` |  | Switch the case of the character under the cursor and move right. |

## Other changes

| Keys | Action |
| --- | --- |
| `r{char}` | Replace the character under the cursor with `{char}`. |
| `J` | Join the next line to this one, with a space between them. In text notes, the lines join the way <kbd>Backspace</kbd> at the start of the next line would join them. |
| `gJ` | Join without adding a space. |
| `p` / `P` | Put the content of a register after / before the cursor. Yanked lines go below / above the current line. |
| `]p` / `[p` | Put, with the indentation of the current line. In text notes, the same as `p` and `P`. |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> / <kbd>Ctrl</kbd>+<kbd>X</kbd> | Add one to / subtract one from the number at or after the cursor. With a count, that amount. |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | The same as `u` and <kbd>Ctrl</kbd>+<kbd>R</kbd>. **Text notes only** |

## Text objects

A text object is typed after an operator or in Visual mode, and names a piece of text around the cursor. `i` takes the inside, and `a` also takes what surrounds it: `ciw`, `da(`, `yip`.

| Keys | Selects |
| --- | --- |
| `iw` / `aw` | The word, without / with the space next to it. |
| `iW` / `aW` | The same, for a word separated by spaces only. |
| `is` / `as` | The sentence. |
| `ip` / `ap` | The paragraph, without / with the blank line after it. In text notes, the block around the cursor: a paragraph, a list item (with `ap`, its nested items too), a quote, a table cell, a code block. On a heading, `ip` is the heading and `ap` is the heading with its section. |
| `i(` / `a(` | The text in parentheses, without / with them. Also `i)` and `ib`. |
| `i[` / `a[` | The text in square brackets, without / with them. |
| `i{` / `a{` | The text in braces, without / with them. Also `i}` and `iB`. |
| `i<` / `a<` | The text in angle brackets, without / with them. |
| `i"` / `a"` | The text in double quotes, without / with them. |
| `i'` / `a'` | The text in single quotes, without / with them. |
| `` i` `` / `` a` `` | The text between two backticks, without / with them. The second key is the backtick. |
| `it` / `at` | The content of a tag, without / with the tag, in a note whose language has tags, such as HTML. **Code notes only** |

## Visual mode

| Keys | Action |
| --- | --- |
| Any motion or text object | Extend the selection. |
| `o` | Go to the other end of the selection. |
| `v` / `V` | Switch between characters and whole lines. The key of the current mode leaves Visual mode. |
| `d` or `x` | Delete the selection. |
| `y` | Yank the selection. |
| `c` or `s` | Change the selection. |
| `D` / `Y` | Delete / yank the whole lines of the selection. |
| `S` or `R` | Change the whole lines of the selection. |
| `>` / `<` | Indent / outdent the selected lines. |
| `~` / `u` / `U` | Switch the case / make lower case / make upper case. |
| `J` / `gJ` | Join the selected lines, with / without spaces. |
| `r{char}` | Replace every selected character with `{char}`. |
| `p` or `P` | Replace the selection with the content of a register. |
| `:` | Open the command line for the selected lines. |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Copy the selection to the clipboard, with its formatting, and leave Visual mode. **Text notes only** |
| <kbd>Esc</kbd> | Leave Visual mode. |

In text notes, selecting with the mouse in Normal mode enters Visual mode.

## Registers

A register holds yanked or deleted text. To use one, type `"` and its name before the command: `"ayy` yanks the line into `a`, and `"ap` puts it. In text notes, the registers with a name are _available, but not guaranteed_.

| Register | Holds |
| --- | --- |
| `""` | The last yanked or deleted text. This is the register used when none is named. |
| `"a` to `"z` | What you put there. With a capital letter, `"A` to `"Z`, the text is added to what the register holds. |
| `"0` | The last yanked text. |
| `"1` to `"9` | The last deleted lines, the most recent first. |
| `"-` | The last deleted text that was shorter than a line. |
| `"_` | Nothing: text deleted into it is gone and leaves the other registers as they are. |
| `".` | The last inserted text. |
| `":` | The last command of the command line. |
| `"/` | The last search pattern. |
| `"+` | The system clipboard. In text notes, `"+y` copies with the formatting. |
| `"*` | The system clipboard as well. **Text notes only** |

| Keys | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> `{register}` | In Insert mode, insert the content of the register. |
| `:registers` | List the registers and what they hold. |

In text notes, registers keep the formatting of the text, such as bold, links and colors. All text notes share one set of registers, and code notes have another.

## Marks and jumps

A mark remembers a position in the note. The jump list remembers the positions that large motions left, such as `G`, `/` and `%`. In text notes, marks are _available, but not guaranteed_.

Two keys go to a mark: the backtick, written `` ` ``, and the apostrophe, written `'`.

| Keys | Action |
| --- | --- |
| `m{a-z}` | Set the mark with that letter at the cursor: `ma`. |
| Backtick, then the letter | Go to the mark: `` `a ``. |
| Apostrophe, then the letter | Go to the first non-blank character of the line of the mark: `'a`. |
| Backtick or apostrophe, twice | Go back to the position before the last jump: ` `` ` or `''`. |
| Backtick, then `.` | Go to the last change: `` `. ``. |
| Backtick, then `<` or `>` | Go to the start / end of the last selection: `` `< ``, `` `> ``. |
| `]`, then backtick / `[`, then backtick | Go to the next / previous mark. |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> / <kbd>Ctrl</kbd>+<kbd>I</kbd> | Go back / forward through the jump list. |
| `:marks` | List the marks. |
| `:delmarks {marks}` | Delete the marks: `:delmarks a`, `:delmarks a-d`. |

## Macros

A macro records keys and plays them again. In text notes, macros are _available, but not guaranteed_.

| Keys | Action |
| --- | --- |
| `q{a-z}` | Start recording into the register with that letter. `q` stops the recording. |
| `@{a-z}` | Play the macro of that register. With a count, that many times. |
| `@@` | Play the last played macro again. |

## Searching

| Keys | Action |
| --- | --- |
| `/pattern` and <kbd>Enter</kbd> | Search forward. The matches are highlighted as you type. |
| `?pattern` and <kbd>Enter</kbd> | Search backward. |
| `n` / `N` | Go to the next / previous match. |
| `*` / `#` | Search forward / backward for the word under the cursor, as a whole word. |
| `g*` / `g#` | The same, also inside longer words. |
| `gn` / `gN` | Select the next / previous match. After an operator, act on it: `cgn` changes the next match. |
| `:noh` | Clear the highlights. In text notes, <kbd>Esc</kbd> in Normal mode does it too. |

*   A pattern is a JavaScript regular expression, not one in Vim's own syntax.
*   Upper and lower case are treated as the same, unless the pattern contains a capital letter.
*   In the search prompt, <kbd>↑</kbd> and <kbd>↓</kbd> bring back earlier searches, and <kbd>Ctrl</kbd>+<kbd>U</kbd> clears the prompt.
*   In text notes, a match cannot span more than one line. Searching looks inside collapsed headings and list items, and expands the one that holds a match.

## Folding

These keys act on [collapsible headings](../Collapsible%20headings.md), collapsible list items and <a class="reference-link" href="../Collapsible%20blocks.md">Collapsible blocks</a>.

| Keys | Action |
| --- | --- |
| `za` | Collapse or expand what is at the cursor. **Trilium-exclusive** **Text notes only** |
| `zo` / `zc` | Expand / collapse it. **Trilium-exclusive** **Text notes only** |
| `zA` / `zO` / `zC` | The same as `za`, `zo` and `zc`, including the sections nested inside. **Trilium-exclusive** **Text notes only** |

## Links and tabs

| Keys | Action |
| --- | --- |
| `gf` | Follow the [link](../Links.md) or [link preview](../Link%20Previews.md) under the cursor. **Trilium-exclusive** **Text notes only** |
| `ZZ` | Close the tab of the note, or its split. **Trilium-exclusive** **Text notes only** |

## Insert mode

In Insert mode, the keys type text. The keys below are the exceptions, in two groups.

### Keys that always follow Vim

| Keys | Action |
| --- | --- |
| <kbd>Esc</kbd>, <kbd>Ctrl</kbd>+<kbd>[</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd> | Return to Normal mode. In text notes, <kbd>Ctrl</kbd>+<kbd>C</kbd> copies when something is selected. |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Run one Normal-mode command, then return to Insert mode. |
| <kbd>Ctrl</kbd>+<kbd>W</kbd> | Delete the word before the cursor. Does not work in a browser on Windows and Linux, where it closes the browser tab. |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> `{register}` | Insert the content of a register. |
| <kbd>Ctrl</kbd>+<kbd>T</kbd> / <kbd>Ctrl</kbd>+<kbd>D</kbd> | Indent / outdent the line. <kbd>Ctrl</kbd>+<kbd>T</kbd> does not work in a browser on Windows and Linux, where it opens a browser tab. |

### Keys that depend on a setting

In text notes, the six shortcuts below follow Vim only while the _Vim keys in Insert mode_ setting is on, see <a class="reference-link" href="../Vim%20mode.md">Vim mode</a>. While it is off, which is the default, they keep the meaning the editor gives them: <kbd>Ctrl</kbd>+<kbd>U</kbd> underlines, <kbd>Ctrl</kbd>+<kbd>Y</kbd> redoes, <kbd>Ctrl</kbd>+<kbd>K</kbd> creates a link, <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes and <kbd>Ctrl</kbd>+<kbd>A</kbd> selects all.

Code notes have no such setting. There, <kbd>Ctrl</kbd>+<kbd>U</kbd> always follows Vim, and the other five are not Vim keys.

| Keys | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>U</kbd> | Delete from the cursor to the start of the line. In text notes, with the setting on; in code notes, always. |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Insert the character that is below / above the cursor. With the setting on. **Text notes only** |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> `{char}{char}` | Insert a digraph, a character typed as two keys: `e:` gives `ë`. With the setting on. **Text notes only** |
| <kbd>Ctrl</kbd>+<kbd>V</kbd> `{key}` | Insert the next key as it is, such as <kbd>Tab</kbd>. With the setting on. **Text notes only** |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Insert the last inserted text again. With the setting on. **Text notes only** |

## Command line

`:` opens the command line. Type a command and press <kbd>Enter</kbd> to run it, or <kbd>Esc</kbd> to cancel. A command can be shortened to its first letters, as the tables show: `:s` is `:substitute`. In text notes, the command line opens in the status bar; in code notes, at the bottom of the editor.

| Keys | Action |
| --- | --- |
| <kbd>Enter</kbd> | Run the command. |
| <kbd>Esc</kbd> | Close the command line. |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Bring back earlier commands. |
| <kbd>Ctrl</kbd>+<kbd>U</kbd> | Clear the command line. |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Go to the next / previous suggestion. **Text notes only** |
| <kbd>↓</kbd> / <kbd>↑</kbd> | Go to the next / previous suggestion while they are shown. Until you type or pick a suggestion, <kbd>↑</kbd> brings back earlier commands instead, as does <kbd>↓</kbd> after it. **Text notes only** |

### Ranges

Many commands act on a range of lines, written before the name. Without a range, they act on the current line.

| Range | Lines |
| --- | --- |
| `:12` | Line 12. Typed alone, it moves the cursor to that line. |
| `:.` / `:$` | The current line / the last line. |
| `:%` | The whole note. |
| `:5,12` | Lines 5 to 12. |
| `:.,+3` | The current line and the next three. |
| `:.,$` | From the current line to the end. |
| `:'a,'b` | From the mark `a` to the mark `b`. |
| `:'<,'>` | The lines of the selection. Pressing `:` in Visual mode writes it for you. |

### Commands

| Command | Action |
| --- | --- |
| `:s/pattern/replacement/flags` | Replace the first match of the pattern in each line of the range. See _Replacing_ below. |
| `:sor` | Sort the lines. See _Sorting_ below. |
| `:u` / `:red` | Undo / redo. |
| `:start` | Enter Insert mode. |
| `:noh` | Clear the search highlights. |
| `:se` | Change an option. See _Options_ below. |

### Commands that are available, but not guaranteed in text notes

These work in both kinds of notes. In text notes they belong to the level described under _Available, but not guaranteed_, as do the key mappings below.

| Command | Action |
| --- | --- |
| `:g/pattern/command` | Run a command on every line that matches the pattern: `:g/^TODO/d`. |
| `:v/pattern/command` | Run a command on every line that does not match. |
| `:d` | Delete the lines. |
| `:y` | Yank the lines. |
| `:pu` | Put the content of a register below the line. |
| `:j` | Join the lines. |
| `:norm {keys}` | Type Normal-mode keys on each line of the range. |
| `:reg` | List the registers. |
| `:marks` / `:delm {marks}` | List / delete marks. |

### Trilium commands

Code notes have none of these: there, `:w` does nothing and `:q` is not a command, since notes are saved by Trilium itself.

| Command | Action |
| --- | --- |
| `:w` | Save the note now. Trilium also saves by itself. **Trilium-exclusive** **Text notes only** |
| `:q` | Close the tab of the note, or its split, after saving. `:wq` and `:x` do the same. **Trilium-exclusive** **Text notes only** |
| `:ck {command} {value}` | Run a command of the text editor by its name: `:ck bold`, `:ck heading heading2`, `:ck horizontalLine`. With a range or after a selection, it acts on that text. The command line lists the commands as you type. **Trilium-exclusive** **Text notes only** |
| `:set hints` / `:set nohints` | Turn the key hints on / off. **Trilium-exclusive** **Text notes only** |

### Replacing

`:s/pattern/replacement/flags` replaces text in the current line, `:%s` in the whole note, and `:'<,'>s` in the selected lines.

| Part | Meaning |
| --- | --- |
| `pattern` | A JavaScript regular expression. |
| `$1`, `$2` in the replacement | The text of a group of the pattern. |
| `$&` in the replacement | The whole match, in text notes. In code notes, the whole match is written `&`. |
| `\n` in the replacement | A line break. In text notes, it starts a new paragraph. |
| Flag `g` | Replace every match in the line, not only the first. |
| Flag `i` | Treat upper and lower case as the same. |
| Flag `c` | Ask before each replacement: `y` replaces, `n` skips, `a` replaces all the rest, `q` stops, `l` replaces this one and stops. |

### Sorting

`:sort` sorts the lines of the range, or of the selection.

| Argument | Meaning |
| --- | --- |
| `!` | Reverse the order: `:sort!`. |
| `i` | Treat upper and lower case as the same. |
| `n` | Sort by the first number in each line. `x` reads hexadecimal numbers, `o` octal ones. |
| `u` | Keep only one of the lines that are equal. |
| `/pattern/` | Sort by the text that follows the match. With `r`, by the match itself. |

In text notes, `:sort` moves paragraphs and list items whole, with their formatting, and a list item takes its nested items along. Without a range, it sorts the list the cursor is in, at the level of the cursor, or the paragraphs around the cursor; in code notes, it sorts the whole note. Lines of different kinds, such as paragraphs mixed with list items, and the rows of a table cannot be sorted this way. To sort tables and for more options, see <a class="reference-link" href="../Sorting.md">Sorting</a>.

### Key mappings

A mapping gives keys another meaning. In text notes, mappings are _available, but not guaranteed_.

| Command | Action |
| --- | --- |
| `:map {keys} {target}` | Make `{keys}` act as `{target}`, in every mode. |
| `:nmap` / `:vmap` / `:imap` | The same, in Normal / Visual / Insert mode only. |
| `:noremap`, `:nnoremap`, `:vnoremap`, `:inoremap` | The same, where the keys of the target keep their original meaning even if they are mapped too. |
| `:unmap {keys}` | Remove a mapping made with `:map`. It does not remove a mapping of one mode. |
| `:mapclear` | Remove all mappings. `:nmapclear`, `:vmapclear` and `:imapclear` remove those of one mode. |

*   Keys with a name are written in angle brackets: `<Esc>`, `<CR>` for <kbd>Enter</kbd>, `<Space>`, `<BS>` for <kbd>Backspace</kbd>, `<C-r>` for <kbd>Ctrl</kbd>+<kbd>R</kbd>.
*   A target that starts with `:` is a command of the command line. End it with `<CR>` to run it at once: `:nmap gs :sort<CR>`. Without `<CR>`, the command line opens with the command typed and waits for <kbd>Enter</kbd>.
*   `:imap jk <Esc>` leaves Insert mode when `j` and `k` are typed quickly one after the other.
*   A mapping lasts until Trilium is reloaded. To keep one in text notes, add it to the _Startup commands_ setting, see <a class="reference-link" href="../Vim%20mode.md">Vim mode</a>.

### Options

| Command | Action |
| --- | --- |
| `:set hints` / `:set nohints` | Turn the key hints on / off. **Trilium-exclusive** **Text notes only** |
| `:set textwidth=80` | Set the width that `gq` wraps lines at. Also `:set tw=80`. **Code notes only** |

## Not supported

These parts of Vim are not available in either kind of note:

*   The windows, buffers, tabs and files of Vim: the window commands that start with <kbd>Ctrl</kbd>+<kbd>W</kbd> in Normal mode, and commands such as `:e` and `:help`. In Insert mode, <kbd>Ctrl</kbd>+<kbd>W</kbd> is supported and deletes a word. `:q!` and `ZQ` only show a message in text notes, since there is nothing to discard.
*   The Normal-mode commands in the table below.
*   The marks `[` and `]`, which in Vim hold the ends of the last changed text.
*   Search patterns in Vim's own syntax.
*   Plugins, scripts and `.vimrc` files made for Vim.
*   Visual Block mode, which selects a rectangle of text across several lines. In text notes, <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes in Normal and Visual mode. In code notes, <kbd>Ctrl</kbd>+<kbd>V</kbd> or <kbd>Ctrl</kbd>+<kbd>Q</kbd> does start the mode, but the selection stays on one line, so it does not work as a rectangle.

| Normal-mode keys | What they do in Vim |
| --- | --- |
| `gp` / `gP` | Put, and leave the cursor after the put text. |
| `@:` | Repeat the last command of the command line. |
| `&` / `g&` | Repeat the last `:s`, on the line / on every line. The `&` inside the replacement of `:s` is something else, and is described under _Replacing_. |
| `g;` / `g,` | Go to the previous / next place where the text was changed. |
| `U` | Undo all the changes made to the line. In Visual mode, `U` makes the selection upper case, and that is supported. |
| `K` | Look up the word under the cursor. |
| `Q` | Switch to Ex mode. |
| <kbd>Ctrl</kbd>+<kbd>]</kbd> | Jump to the definition of the word under the cursor. |
| `zf` | Create a fold by hand. |