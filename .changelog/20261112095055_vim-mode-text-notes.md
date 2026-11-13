---
type: highlight
title: Vim mode in text notes
---

Code notes have had Vim key bindings for years, but text notes, where most of the writing in Trilium happens, had none. For anyone used to Vim, every text note meant putting that habit aside and going back to the mouse and the arrow keys. Vim users have asked for this since 2021, and now the time has finally come to make it real: text notes have a Vim mode of their own. It runs on the same Vim engine as code notes, so the commands work as they do there, and it understands the structure of rich text: a paragraph, a heading, a list item, a table cell and a line of code are each a line; an image, a diagram or an included note is one line that `j` and `k` stop on and `dd` deletes; and yanked text keeps its bold, links and colors when it is put back. Insert mode is the editor as it was, with its formatting shortcuts, slash commands and Markdown autoformatting.

Motions, operators, text objects, counts, repeating with `.`, registers, marks, macros, search and `:s` all work, inside included notes too. Trilium commands join them: `:w` saves the note, `:q` closes it, `gf` follows the link under the cursor, `za` folds a heading, list item or collapsible block, `:sort` sorts lines, `:ck` runs any editor command, and `"+y` copies to the system clipboard with the formatting. The status bar shows the mode, the keys of a pending command and macro recording, and `:`, `/` and `?` open the command line in place of the breadcrumb. Zen mode keeps both.

Key hints help while you learn and stay quiet otherwise. Normal and Visual mode show their keys in the status bar, and a pause in the middle of a command shows the keys that can follow it. The command line completes command names with `Tab`, the search prompt tells how the pattern is read, and `Alt+F1` or a click on the mode lists every key. `Esc` in Normal mode switches between the keys and the breadcrumb, and the Key hints option turns them off.

Turn it on in Options → Text Notes → Features → Vim mode, on each device where you want it. The Vim badge in the status bar, or a `#vimMode` label, turns it on or off for a single note, and startup commands set up mappings such as `imap jk <Esc>`.
