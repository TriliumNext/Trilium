---
type: breaking
---

Multi-level `#sorted` values introduced in v0.106.0 must now write labels with `#`, as search's `orderBy` does: `#sorted="priority desc, dueDate"` becomes `#sorted="#priority desc, #dueDate"`. Values without `#` fall back to sorting by title. A single name (`#sorted=myOrder`) and property-only values (`dateModified desc, title`) are unaffected. See [Sorting Notes](https://docs.triliumnotes.org/user-guide/concepts/notes/sorting).
