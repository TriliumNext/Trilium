# Trilium Search Syntax

## Full-text search
- `rings tolkien` — notes containing both words
- `"The Lord of the Rings"` — exact phrase match

## Label filters
- `#book` — notes with the "book" label
- `#!book` — notes WITHOUT the "book" label
- `#publicationYear = 1954` — exact value
- `#genre *=* fan` — contains substring
- `#title =* The` — starts with
- `#title *= Rings` — ends with
- `#publicationYear >= 1950` — numeric comparison (>, >=, <, <=)
- `#dateNote >= TODAY-30` — date keywords: NOW+-seconds, TODAY+-days, MONTH+-months, YEAR+-years
- `#phone %= '\d{3}-\d{4}'` — regex match
- `#title ~= trilim` — fuzzy exact match (tolerates typos, min 3 chars)
- `#content ~* progra` — fuzzy contains match

## Relation filters
- `~author` — notes with an "author" relation
- `~author.title *=* Tolkien` — relation target's title contains "Tolkien"
- `~author.relations.son.title = 'Christopher Tolkien'` — deep relation traversal

## Note properties
Access via `note.` prefix: noteId, title, type, mime, text, content, rawContent, dateCreated, dateModified, isProtected, isArchived, parentCount, childrenCount, attributeCount, labelCount, relationCount, contentSize, revisionCount.
- `note.type = code AND note.mime = 'application/json'`
- `note.content *=* searchTerm`

## Hierarchy
- `note.parents.title = 'Books'` — parent named "Books"
- `note.ancestors.title = 'Books'` — any ancestor named "Books"
- `note.children.title = 'sub-note'` — child named "sub-note"

## Boolean logic
- AND: `#book AND #fantasy` (implicit between adjacent expressions)
- OR: `#book OR #author`
- NOT: `not(note.ancestors.title = 'Tolkien')`
- Parentheses: `(#genre = "fantasy" AND #year >= 1950) OR #award`

## Combining full-text and attributes
- `towers #book` — full-text "towers" AND has #book label
- `tolkien #book or #author` — full-text with OR on labels

## Ordering and limiting
- `#author=Tolkien orderBy #publicationDate desc, note.title limit 10`

## Escaping
- `\#hash` — literal # in full-text
- Three quote types: single, double, backtick
