---
type: fix
area: General
---

The consistency checks could hang while repairing a cycle in the note tree, and could not repair a note whose content was missing or empty, reporting it again on every run.
