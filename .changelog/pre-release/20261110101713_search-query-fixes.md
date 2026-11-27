---
type: fix
area: Search
---

Searching for an empty quoted phrase (`""`) failed with an error, and a `!=` search that included the flat text of attributes returned notes whose content contained the excluded word.
