# Trilium Dashboard Collections

A dashboard is a collection view that renders each child note as a widget on a drag-and-drop grid, similar to Grafana or a home-automation dashboard. The user can freely place and resize the widgets; the layout is saved automatically.

## Creating a dashboard

1. Create a note of type `book` (`create_note` with type `book`).
2. Set the `viewType` label to `dashboard` on it (`set_attribute` with type `label`, name `viewType`, value `dashboard`).

Every child note of the dashboard becomes a widget.

## Widget types

A widget is just a child note, rendered with its normal content. Pick the note type by what the widget should show:

| Widget should show | Child note type |
|---|---|
| Formatted text, checklists, links | `text` |
| A diagram | `mermaid` |
| A code snippet | `code` |
| An embedded web page | `webView` (content is the URL) |
| A drawing | `canvas` |
| **Dynamic / interactive content** | `render` + a Preact JSX child note (see below) |

After creating a widget note, ALWAYS give it an icon: find a fitting one with `search_icons` and assign it with `set_attribute` as the widget note's `iconClass` label (e.g. `bx bx-line-chart`). The icon is shown in the widget's title bar. Never prepend an emoji to the widget title instead.

## Interactive widgets (Preact render notes) — preferred for dynamic content

For widgets that compute something, fetch data, or respond to clicks, use a render note backed by a Preact JSX component:

1. Create a note of type `render` as a **child of the dashboard** — this is the widget.
2. Create a `code` note with mime `text/jsx` as a **child of the render note**, exporting a default component.
3. Ask the user to activate the widget by adding a `~renderNote` relation on the render note pointing to the JSX note. You CANNOT set this relation yourself — it enables code execution, so `set_attribute` refuses it as dangerous. Tell the user exactly what to do, e.g.: "Open the widget note '<render note title>', click the attribute area at the top, and add `~renderNote` pointing to '<JSX note title>'." Mention which JSX note to target by title.

JSX rules (load the `frontend_scripting` skill for the full API):

- Use top-level ES `import` only; hooks come from `"trilium:preact"`, API methods from `"trilium:api"`.
- NEVER use `React`, `require()`, or `await import()` — Trilium uses Preact and JSX notes are ES modules.
- Export the component as `export default`.
- To reference the widget's own note (e.g. to read its attributes or store data under it), use `originEntity` from `"trilium:api"` — it is the render note hosting the component. Do NOT use `getActiveContextNote()`: on a dashboard the active note is the dashboard itself, not the widget.

Example — a widget showing the number of notes created in the last 7 days:

```jsx
import { useState, useEffect } from "trilium:preact";
import { searchForNotes } from "trilium:api";

export default function RecentNotesWidget() {
    const [count, setCount] = useState(null);

    useEffect(() => {
        searchForNotes("note.dateCreated >= TODAY-7").then(notes => setCount(notes.length));
    }, []);

    return (
        <div style="text-align: center;">
            <h3>Notes this week</h3>
            <strong style="font-size: 2em;">{count === null ? "…" : count}</strong>
        </div>
    );
}
```

## Layout behavior

- The grid has 12 columns; one row is about 80 px tall. New widgets default to 4 columns × 3 rows and are placed automatically in the first free spot.
- The user rearranges widgets by dragging the title bar and resizes them from the bottom-right corner. You cannot position widgets programmatically — create them and let auto-placement handle it; the user adjusts afterwards.
- The layout persists in a `dashboard.json` attachment (role `viewConfig`) on the dashboard note. It is managed by the UI and syncs across devices and splits. You cannot alter it — no tool can modify attachments — and there is no need to: the dashboard automatically picks up new child notes as widgets and auto-places them.
- On narrow screens (under ~768 px) the dashboard collapses to a single read-only column; the saved layout is unaffected.

## Tips

- Keep widget content compact — widgets clip overflowing content with scrollbars.
- Give widgets meaningful titles; the title bar is always visible and doubles as the drag handle.

## Anti-patterns (do NOT do this)

- ❌ Putting the JSX code note directly under the dashboard — it would render as a code widget showing its own source. The JSX note belongs under the render note.
- ❌ Calling `set_attribute` with `~renderNote` — it will be rejected as dangerous. Ask the user to add the relation instead.
- ❌ Directing the user to set `~renderNote` on the dashboard note itself — it belongs on the `render`-type child.
- ❌ Trying to write the `dashboard.json` attachment (or any view configuration) to lay out widgets — attachments cannot be modified by tools, and the dashboard picks up new widgets automatically; rely on auto-placement.
- ❌ Using `getActiveContextNote()` inside a widget's JSX to get "this widget's note" — when the dashboard is open, the active note is the dashboard, not the widget. Use `originEntity` (the render note) instead.
- ❌ Setting `#viewType=dashboard` on a `text` note — the view type only applies to `book` (and search) notes.
- ❌ Prepending an emoji to a widget title to decorate it — find an icon with `search_icons` and set the `iconClass` label instead.
