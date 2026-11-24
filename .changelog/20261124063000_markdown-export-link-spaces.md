---
type: fix
area: Import and export
---

Markdown export wrote a link whose address contains a space, such as a `file://` link to a folder with a space in its name, as `[text](file:///C:/My Documents/x.pdf)`, which Markdown readers show as plain text; spaces in link addresses are now written as `%20`, as image addresses already were, and backslashes are escaped so an address ending in one no longer swallows the closing parenthesis.
