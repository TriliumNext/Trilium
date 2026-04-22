# Trilium Backend Scripting

Backend scripts run in Node.js on the server. They have direct access to notes in memory and can interact with the system (files, processes).

## Creating a backend script

1. Create a Code note with language "JS backend".
2. The script can be run manually (Execute button) or triggered automatically.

## Script API (`api` global)

### Note retrieval
- `api.getNote(noteId)` - get note by ID
- `api.searchForNotes(query, searchParams)` - search notes (returns array)
- `api.searchForNote(query)` - search notes (returns first match)
- `api.getNotesWithLabel(name, value?)` - find notes by label
- `api.getNoteWithLabel(name, value?)` - find first note by label
- `api.getBranch(branchId)` - get branch by ID
- `api.getAttribute(attributeId)` - get attribute by ID

### Note creation
- `api.createTextNote(parentNoteId, title, content)` - create text note
- `api.createDataNote(parentNoteId, title, content)` - create JSON note
- `api.createNewNote({ parentNoteId, title, content, type })` - create note with full options

### Branch management
- `api.ensureNoteIsPresentInParent(noteId, parentNoteId, prefix?)` - create or reuse branch
- `api.ensureNoteIsAbsentFromParent(noteId, parentNoteId)` - remove branch if exists
- `api.toggleNoteInParent(present, noteId, parentNoteId, prefix?)` - toggle branch

### Calendar/date notes
- `api.getTodayNote()` - get/create today's day note
- `api.getDayNote(date)` - get/create day note (YYYY-MM-DD)
- `api.getWeekNote(date)` - get/create week note
- `api.getMonthNote(date)` - get/create month note (YYYY-MM)
- `api.getYearNote(year)` - get/create year note (YYYY)

### Utilities
- `api.log(message)` - log to Trilium logs and UI
- `api.randomString(length)` - generate random string
- `api.escapeHtml(string)` / `api.unescapeHtml(string)`
- `api.getInstanceName()` - get instance name
- `api.getAppInfo()` - get application info

### Libraries
- `api.dayjs` - date manipulation
- `api.xml2js` - XML parser
- `api.htmlParser` - HTML parser (node-html-parser), use `api.htmlParser.parse(html)` to parse
- `api.cheerio` - **DEPRECATED**, use `api.htmlParser` instead

### HTTP Requests
Use the native `fetch()` API for HTTP requests:
```javascript
const response = await fetch('https://api.example.com/data');
const data = await response.json();
```

Note: `api.axios` was removed in 2026 due to a supply chain security incident. Use `fetch()` instead.

### Advanced
- `api.transactional(func)` - wrap code in a database transaction
- `api.sql` - direct SQL access
- `api.sortNotes(parentNoteId, sortConfig)` - sort child notes
- `api.runOnFrontend(script, params)` - execute code on all connected frontends
- `api.backupNow(backupName)` - create a backup
- `api.exportSubtreeToZipFile(noteId, format, zipFilePath)` - export subtree (format: "markdown" or "html")
- `api.duplicateSubtree(origNoteId, newParentNoteId)` - clone note and children

## BNote object

Available on notes returned from API methods (`api.getNote()`, `api.originEntity`, etc.).

### Content
- `note.getContent()` / `note.setContent(content)`
- `note.getJsonContent()` / `note.setJsonContent(obj)`
- `note.getJsonContentSafely()` - returns null on parse error

### Properties
- `note.noteId`, `note.title`, `note.type`, `note.mime`
- `note.dateCreated`, `note.dateModified`
- `note.isProtected`, `note.isArchived`

### Hierarchy
- `note.getParentNotes()` / `note.getChildNotes()`
- `note.getParentBranches()` / `note.getChildBranches()`
- `note.hasChildren()`, `note.getAncestors()`
- `note.getSubtreeNoteIds()` - all descendant IDs
- `note.hasAncestor(ancestorNoteId)`

### Attributes (including inherited)
- `note.getLabels(name?)` / `note.getLabelValue(name)`
- `note.getRelations(name?)` / `note.getRelation(name)`
- `note.hasLabel(name, value?)` / `note.hasRelation(name, value?)`

### Attribute modification
- `note.setLabel(name, value?)` / `note.removeLabel(name, value?)`
- `note.setRelation(name, targetNoteId)` / `note.removeRelation(name, value?)`
- `note.addLabel(name, value?, isInheritable?)` / `note.addRelation(name, targetNoteId, isInheritable?)`
- `note.toggleLabel(enabled, name, value?)`

### Operations
- `note.save()` - persist changes
- `note.deleteNote()` - soft delete
- `note.cloneTo(parentNoteId)` - clone to another parent

### Type checks
- `note.isJson()`, `note.isJavaScript()`, `note.isHtml()`, `note.isImage()`
- `note.hasStringContent()` - true if not binary

## Events and triggers

### Global events (via `#run` label on the script note)
- `#run=backendStartup` - run when server starts
- `#run=hourly` - run once per hour (use `#runAtHour=N` to specify which hours)
- `#run=daily` - run once per day

### Entity events (via relation from the entity to the script note)
These are defined as relations. `api.originEntity` contains the entity that triggered the event.

| Relation | Trigger | originEntity |
|---|---|---|
| `~runOnNoteCreation` | note created | BNote |
| `~runOnChildNoteCreation` | child note created under this note | BNote (child) |
| `~runOnNoteTitleChange` | note title changed | BNote |
| `~runOnNoteContentChange` | note content changed | BNote |
| `~runOnNoteChange` | note metadata changed (not content) | BNote |
| `~runOnNoteDeletion` | note deleted | BNote |
| `~runOnBranchCreation` | branch created (clone/move) | BBranch |
| `~runOnBranchChange` | branch updated | BBranch |
| `~runOnBranchDeletion` | branch deleted | BBranch |
| `~runOnAttributeCreation` | attribute created on this note | BAttribute |
| `~runOnAttributeChange` | attribute changed/deleted on this note | BAttribute |

Relations can be inheritable — when set, they apply to all descendant notes.

## Example: auto-color notes by category

```javascript
// Attach via ~runOnAttributeChange relation
const attr = api.originEntity;
if (attr.name !== "mycategory") return;
const note = api.getNote(attr.noteId);
if (attr.value === "Health") {
    note.setLabel("color", "green");
} else {
    note.removeLabel("color");
}
```

## Example: create a daily summary

```javascript
// Attach #run=daily label
const today = api.getTodayNote();
const tasks = api.searchForNotes('#task #!completed');
let summary = "## Open Tasks\n";
for (const task of tasks) {
    summary += `- ${task.title}\n`;
}
api.createTextNote(today.noteId, "Daily Summary", summary);
```

## Module system

Child notes of a script act as modules. Export with `module.exports = ...` and import via function parameters matching the child note title, or use `require('noteName')`.
