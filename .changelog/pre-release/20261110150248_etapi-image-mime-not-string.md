---
type: fix
area: ETAPI
---

Patching an image note through ETAPI with a `mime` that was not a string answered with a 500 error instead of a 400 validation error.
