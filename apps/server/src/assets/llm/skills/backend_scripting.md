# Trilium Backend Scripting

Backend scripts run in Node.js on the server. They have direct access to notes in memory and can interact with the system (files, processes).

## Creating a backend script

1. Create a Code note with language "JavaScript (Trilium backend)".
2. The script can be run manually (Execute button) or triggered automatically.

## Async code — IMPORTANT

The script body runs inside a **regular (non-async) function**, so **top-level `await` is NOT allowed**. Writing `await` directly at the top level fails with: *"await is only valid in async functions and the top level bodies of modules"*.

To use `await`, wrap the awaited code in an async IIFE:

```javascript
(async () => {
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    api.log(JSON.stringify(data));
})();
```

Note that most `api.*` methods (e.g. `api.getNote`, `api.searchForNotes`, `api.createTextNote`) are **synchronous** and do not need `await` at all. Only genuinely async operations like `fetch()` require the wrapper above.

## Script API (`api` global)

### Script context
- `api.startNote` - note where the script execution started (the entry point of the script bundle; in C terms, the file with `main()`). All module notes loaded via `require()` share the same `startNote`. May be null when the execution came from the frontend via `runOnBackend()` (the frontend's `startNote` is preserved). `api.log()` messages are grouped under this note.
- `api.currentNote` - note containing the source code currently executing (in C terms, `__FILE__`). Equal to `startNote` except inside child module notes loaded via `require()`. NOT the note open in the UI.
- `api.originEntity` - entity whose event triggered this execution; `undefined` when the run was not event-driven (manual Execute button, `note.executeScript()`). For `~runOn*` relations see the table under "Events and triggers"; for scheduled scripts (`#run=hourly`/`#run=daily`) it is the script note itself; for `~searchScript` scripts it is the search note.

Concrete examples:

| Scenario | `startNote` | `currentNote` | `originEntity` |
|---|---|---|---|
| Execute button / `note.executeScript()` on "Job" | "Job" | "Job" (a child module note while its code runs) | `undefined` |
| Scheduled "Job" (`#run=backendStartup`/`hourly`/`daily`) | "Job" | "Job" (or module note) | "Job" (the script note itself) |
| Note "Diary" has `~runOnNoteContentChange` → script "OnChange" | "OnChange" | "OnChange" (or module note) | "Diary" (the changed note; a BAttribute/BBranch for attribute/branch events) |
| Custom request handler "Endpoint" (`#customRequestHandler`) | "Endpoint" | "Endpoint" (or module note) | `undefined` — the request is in `api.req` |
| `api.runOnBackend()` called from frontend widget "Clock" | "Clock" (the frontend's `startNote`, preserved) | the frontend note whose function was serialized (the frontend's `currentNote`) | the frontend's `originEntity` (a note) or `null` |

Note: `#customResourceProvider` notes never execute a script — the note's content is served directly as the HTTP response, so there is no `api` context at all. Only `#customRequestHandler` runs code.

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
Use the native `fetch()` API for HTTP requests. Since `fetch()` is async and top-level `await` is not allowed (see "Async code" above), wrap it in an async IIFE:
```javascript
(async () => {
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    api.log(JSON.stringify(data));
})();
```

Note: `api.axios` was removed in March 2026 following an npm supply chain attack. Use `fetch()` instead.

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

## Custom request handlers

A backend script with a `#customRequestHandler` label becomes a public REST endpoint under `/custom/...`. The label value is a regular expression matched against the request path (e.g. `#customRequestHandler=create-note` is reachable at `/custom/create-note`).

**The label MUST have a value** — a bare `#customRequestHandler` with no value matches nothing and the endpoint will never run. Always give it a path regex (e.g. `#customRequestHandler=create-note`).

The Express request and response objects are exposed as **`api.req`** and **`api.res`** — **not** bare `req`/`res`. Write the HTTP response by calling methods on `api.res`.

```javascript
const { req, res } = api; // destructure from api — api.req / api.res, never global req/res
const { secret, title, content } = req.body;

if (req.method === "POST" && secret === "secret-password") {
    const targetParentNoteId = api.currentNote.getRelationValue("targetNote");
    const { note } = api.createTextNote(targetParentNoteId, title, content);
    res.status(201).json(note.getPojo());
} else {
    res.sendStatus(400);
}
```

- Regex capture groups from the matched path are available in **`api.pathParams`** (e.g. `#customRequestHandler=notes/([0-9]+)` → `api.pathParams[0]`).
- Query params come from standard Express: `api.req.query.noteId`.
- These endpoints are **unauthenticated** by default — handle authentication yourself (e.g. a shared secret as above).

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
