# Trilium Frontend Scripting

Frontend scripts run in the browser. They can manipulate the UI, navigate notes, show dialogs, and create custom widgets.

IMPORTANT: Always prefer Preact JSX widgets over legacy jQuery widgets. Use JSX code notes with `import`/`export` syntax.

CRITICAL: In JSX notes, always use top-level `import` statements (e.g. `import { useState } from "trilium:preact"`). NEVER use dynamic `await import()` for Preact imports — this will break hooks and components. Dynamic imports are not needed because JSX notes natively support ES module `import`/`export` syntax.

## Creating a frontend script

1. Create a Code note with language "JSX" (preferred) or "JavaScript (Trilium frontend)" (legacy only).
2. Add `#widget` label for widgets, or `#run=frontendStartup` for auto-run scripts.
3. For mobile, use `#run=mobileStartup` instead.

## Script types

| Type | Language | Required attribute |
|---|---|---|
| Custom widget | JSX (preferred) | `#widget` |
| Regular script | JavaScript (Trilium frontend) | `#run=frontendStartup` (optional) |
| Render note | JSX | None (used via `~renderNote` relation) |

## Custom widgets (Preact JSX) — preferred

### Basic widget

```jsx
import { defineWidget } from "trilium:preact";
import { useState } from "trilium:preact";

export default defineWidget({
    parent: "center-pane",
    position: 10,
    render: () => {
        const [count, setCount] = useState(0);
        return (
            <div>
                <button onClick={() => setCount(c => c + 1)}>
                    Clicked {count} times
                </button>
            </div>
        );
    }
});
```

### Note context aware widget (reacts to active note)

```jsx
import { defineWidget, useNoteContext, useNoteProperty } from "trilium:preact";

export default defineWidget({
    parent: "note-detail-pane",
    position: 10,
    render: () => {
        const { note } = useNoteContext();
        const title = useNoteProperty(note, "title");
        return <span>Current note: {title}</span>;
    }
});
```

### Right panel widget (sidebar)

```jsx
import { defineWidget, RightPanelWidget, useState, useEffect } from "trilium:preact";

export default defineWidget({
    parent: "right-pane",
    position: 1,
    render() {
        const [time, setTime] = useState();
        useEffect(() => {
            const interval = setInterval(() => {
                setTime(new Date().toLocaleString());
            }, 1000);
            return () => clearInterval(interval);
        });
        return (
            <RightPanelWidget id="my-clock" title="Clock">
                <p>The time is: {time}</p>
            </RightPanelWidget>
        );
    }
});
```

### Widget locations (`parent` values)

| Value | Description | Notes |
|---|---|---|
| `left-pane` | Alongside the note tree | |
| `center-pane` | Content area, spanning all splits | |
| `note-detail-pane` | Inside a note, split-aware | Use `useNoteContext()` hook |
| `right-pane` | Right sidebar section | Wrap in `<RightPanelWidget>` |

### Preact imports

```jsx
// API methods
import { showMessage, showError, getNote, searchForNotes, activateNote,
         runOnBackend, getActiveContextNote } from "trilium:api";

// Hooks and components
import { defineWidget, defineLauncherWidget,
         useState, useEffect, useCallback, useMemo, useRef,
         useNoteContext, useActiveNoteContext, useNoteProperty,
         RightPanelWidget } from "trilium:preact";

// Built-in UI components
import { ActionButton, Button, LinkButton, Modal,
         NoteAutocomplete, FormTextBox, FormToggle, FormCheckbox,
         FormDropdownList, FormGroup, FormText, FormTextArea,
         Icon, LoadingSpinner, Slider, Collapsible } from "trilium:preact";
```

### Custom hooks

- `useNoteContext()` - returns `{ note }` for the current note context (use in `note-detail-pane`)
- `useActiveNoteContext()` - returns `{ note, noteId }` for the active note (works from any widget location)
- `useNoteProperty(note, propName)` - reactively watches a note property (e.g. "title", "type")

### Render notes (JSX)

For rendering custom content inside a note:
1. Create a "render note" (type: Render Note) where you want the content to appear.
2. Create a JSX code note **as a child** of the render note, exporting a default component.
3. On the render note, add a `~renderNote` relation pointing to the child JSX note.

IMPORTANT: Always create the JSX code note as a child of the render note, not as a sibling or at the root. This keeps them organized together.

Stateless example:

```jsx
export default function MyRenderNote() {
    return (
        <>
            <h1>Custom rendered content</h1>
            <p>This appears inside the note.</p>
        </>
    );
}
```

Stateful example — hooks MUST be imported from `"trilium:preact"`:

```jsx
import { useState } from "trilium:preact";

export default function CelsiusToFahrenheit() {
    const [celsius, setCelsius] = useState("");
    const fahrenheit = celsius === "" ? "" : (Number(celsius) * 9 / 5 + 32).toFixed(2);
    return (
        <div>
            <input
                type="number"
                value={celsius}
                onInput={e => setCelsius(e.currentTarget.value)}
            />
            <span>{fahrenheit} °F</span>
        </div>
    );
}
```

### Anti-patterns (do NOT do this)

LLMs often invent syntax that does not exist in Trilium. Avoid these:

- ❌ `trilium.preact.useState(...)` — `trilium` is not a global object; there is no `trilium.preact` namespace
- ❌ `window.trilium.preact.useState(...)` — same; no such global
- ❌ `React.useState(...)` / `import React from "react"` — Trilium uses Preact, NOT React
- ❌ `const { useState } = await import("trilium:preact")` — dynamic imports break hooks; always use top-level `import`
- ❌ `const { useState } = require("trilium:preact")` — JSX notes are ES modules, not CommonJS

The ONLY correct way to use hooks or components is a top-level ES `import`:

```jsx
import { useState, useEffect } from "trilium:preact";
import { showMessage } from "trilium:api";
```

## Script API

In JSX, use `import { method } from "trilium:api"`. In JavaScript (Trilium frontend), use the `api` global.

### Navigation & tabs
- `activateNote(notePath)` - navigate to a note
- `activateNewNote(notePath)` - navigate and wait for sync
- `openTabWithNote(notePath, activate?)` - open in new tab
- `openSplitWithNote(notePath, activate?)` - open in new split
- `getActiveContextNote()` - get currently active note
- `getActiveContextNotePath()` - get path of active note
- `setHoistedNoteId(noteId)` - hoist/unhoist note

### Note access & search
- `getNote(noteId)` - get note by ID
- `getNotes(noteIds)` - bulk fetch notes
- `searchForNotes(searchString)` - search with full query syntax
- `searchForNote(searchString)` - search returning first result

### Calendar/date notes
- `getTodayNote()` - get/create today's note
- `getDayNote(date)` / `getWeekNote(date)` / `getMonthNote(month)` / `getYearNote(year)`

### Editor access
- `getActiveContextTextEditor()` - get CKEditor instance
- `getActiveContextCodeEditor()` - get CodeMirror instance
- `addTextToActiveContextEditor(text)` - insert text into active editor

### Dialogs & notifications
- `showMessage(msg)` - info toast
- `showError(msg)` - error toast
- `showConfirmDialog(msg)` - confirm dialog (returns boolean)
- `showPromptDialog(msg)` - prompt dialog (returns user input)

### Backend integration
- `runOnBackend(func, params)` - execute a function on the backend

### UI interaction
- `triggerCommand(name, data)` - trigger a command
- `bindGlobalShortcut(shortcut, handler, namespace?)` - add keyboard shortcut

### Utilities
- `formatDateISO(date)` - format as YYYY-MM-DD
- `randomString(length)` - generate random string
- `dayjs` - day.js library
- `log(message)` - log to script log pane

## FNote object

Available via `getNote()`, `getActiveContextNote()`, `useNoteContext()`, etc.

### Properties
- `note.noteId`, `note.title`, `note.type`, `note.mime`
- `note.isProtected`, `note.isArchived`

### Content
- `note.getContent()` - get note content
- `note.getJsonContent()` - parse content as JSON

### Hierarchy
- `note.getParentNotes()` / `note.getChildNotes()`
- `note.hasChildren()`, `note.getSubtreeNoteIds()`

### Attributes
- `note.getAttributes(type?, name?)` - all attributes (including inherited)
- `note.getOwnedAttributes(type?, name?)` - only owned attributes
- `note.hasAttribute(type, name)` - check for attribute

## Electron API (desktop only)

Desktop-only functionality is exposed on `window.electronApi` by the preload script. It is **not** part of the `api` global. The global is `undefined` in the browser/server build and in the standalone (WASM) build, so always guard usage.

```jsx
if (window.electronApi) {
    window.electronApi.window.setZoomFactor(1.2);
}
```

Use optional chaining for one-off calls: `window.electronApi?.window.minimizeWindow()`.

### Groups

| Group | What it covers |
|---|---|
| `window` | Zoom, theme, title bar, full screen, lifecycle, devtools, extra windows, global shortcut + open-in-tab events |
| `clipboard` | `copyImageToClipboard(buffer)` for raw PNG bytes |
| `shell` | `openExternal`, `openPath`, `openFileUrl`, `downloadURL`, `openCustom` — all validated in main process |
| `contextMenu` | Subscribe to right-click events, dispatch cut/copy/paste/insertText |
| `spellcheck` | `addWordToDictionary`, `getAvailableSpellCheckerLanguages` |
| `tray` | `reloadTray()` |
| `printing` | PDF export/preview/save, printer list, print progress events |
| `navigation` | Back/forward history accessors and navigation events |

### Common examples

```js
// Open a URL in the user's default browser
window.electronApi?.shell.openExternal("https://example.com");

// Toggle full screen
const api = window.electronApi;
if (api) api.window.setFullScreen(!api.window.isFullScreen());

// Read & adjust zoom
const zoom = window.electronApi?.window.getZoomFactor() ?? 1;
window.electronApi?.window.setZoomFactor(zoom + 0.1);

// React to global shortcuts (configured in Trilium options)
window.electronApi?.window.onGlobalShortcut((actionName) => {
    console.log("shortcut fired:", actionName);
});

// Copy a PNG to the clipboard
const bytes = new Uint8Array(await blob.arrayBuffer());
window.electronApi?.clipboard.copyImageToClipboard(bytes);
```

### Security notes (shell group)

Every `shell.*` call is validated in the main process and will throw on invalid input — the renderer is treated as untrusted:

- `openExternal(url)`: scheme is allowlisted. `file:`, `data:`, `smb:`, `ldap:`/`ldaps:`, `jar:`, `view-source:`, and Follina-class schemes are blocked.
- `openPath(path)`: must resolve under the Trilium data dir or tmp dir. Returns an empty string on success, an error message on failure.
- `openFileUrl(fileUrl)`: handles user-clicked `file:` links inside notes; resolves to any local path (no data/tmp sandbox — these links routinely point at arbitrary user documents). UNC `file://host/share` URLs are blocked (NTLM-leak prevention). Returns an empty string on success, an error message on failure.
- `downloadURL(url)`: pinned to the app's own origin — cross-origin downloads are rejected.
- `openCustom(filePath)`: must be a descendant of the tmp dir and the file must exist.

### Cross-build patterns

Because `window.electronApi` is missing outside desktop, write code that degrades:

```jsx
import { showMessage } from "trilium:api";

function openInBrowser(url) {
    if (window.electronApi) {
        window.electronApi.shell.openExternal(url);
    } else {
        window.open(url, "_blank", "noopener,noreferrer");
    }
}
```

Avoid `require("electron")`, `@electron/remote`, and `process` — `nodeIntegration` is disabled and `contextIsolation` is enabled, so they aren't available in the renderer.

## Legacy jQuery widgets (avoid if possible)

Only use legacy widgets if you specifically need jQuery or cannot use JSX.

```javascript
// Language: JavaScript (Trilium frontend), Label: #widget
class MyWidget extends api.BasicWidget {
    get position() { return 1; }
    get parentWidget() { return "center-pane"; }

    doRender() {
        this.$widget = $("<div>");
        this.$widget.append($("<button>Click me</button>")
            .on("click", () => api.showMessage("Hello!")));
        return this.$widget;
    }
}
module.exports = new MyWidget();
```

Key differences from Preact:
- Use `api.` global instead of imports
- `get parentWidget()` instead of `parent` field
- `module.exports = new MyWidget()` (instance) for most widgets
- `module.exports = MyWidget` (class, no `new`) for `note-detail-pane`
- Right pane: extend `api.RightPanelWidget`, override `doRenderBody()` instead of `doRender()`

## Module system

For JSX, use `import`/`export` syntax between notes. For JavaScript (Trilium frontend), use `module.exports` and function parameters matching child note titles.
