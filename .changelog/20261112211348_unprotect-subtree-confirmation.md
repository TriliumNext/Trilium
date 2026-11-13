---
type: fix
area: Tree
closes: [8660]
---

_Unprotect subtree_ removed encryption without asking, behind the same "Start protected session" prompt as _Protect subtree_; both now say what they do, and unprotecting asks for confirmation.
