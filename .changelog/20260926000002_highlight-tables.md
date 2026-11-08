---
type: highlight
title: Tables in text notes
closes: [11774, 11786]
credits: [adoriandoran]
---

Tables were the editor's weak spot: no merged cells, no sorting, and anything past a few rows meant switching to a spreadsheet note. The [table context menu](https://github.com/TriliumNext/Trilium/pull/11774) now merges and unmerges cells, distributes columns, and inserts or deletes many rows and columns at once. A column sorts by its values, with dates, times, numbers and text detected and ordered per the note's language, and Alt+arrows move rows and columns while keeping merged cells and header rows intact.

Wide tables scroll sideways under a sticky header, and on touch screens a column bar resizes and selects columns while corner handles select cell ranges. The insert form takes any size up to 1000 × 100, with header rows and columns.
