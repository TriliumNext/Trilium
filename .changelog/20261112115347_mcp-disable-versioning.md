---
type: fix
area: LLM
closes: [12563]
---

Editing a note through the LLM chat or the MCP server saved a revision even when the note had `#disableVersioning`, set on it or inherited from a parent.
