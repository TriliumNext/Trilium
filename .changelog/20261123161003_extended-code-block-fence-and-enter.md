---
type: fix
area: Text editor
closes: [12740]
---

Typing `` ``` `` opened an extended code block with the backticks inside, a new block needed a click before it took typing, Enter never left the block, and Backspace did not turn an empty block back into a paragraph.