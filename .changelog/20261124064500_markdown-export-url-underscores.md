---
type: fix
area: Import and export
---

Markdown export escaped every underscore in a web address written as plain text, so `https://en.wikipedia.org/wiki/Hello_World` came out as `Hello\_World`, and GitHub and Trilium's own import turned it into a link to `Hello%5C_World`; underscores between letters or digits in such addresses are no longer escaped.
