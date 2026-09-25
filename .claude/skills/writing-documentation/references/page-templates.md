# Page templates

Skeletons drawn from real pages. Copy the shape, not the words. Line 1 is the H1, line 2 starts the
body, no trailing newline; `docs.mjs sync` normalizes the rest.

## Note-type page (`Note Types/Mind Map.md`, `Canvas.md`, `Spreadsheets.md`, `Mermaid Diagrams.md`)

```markdown
# Mind Map
<figure class="image image-style-align-center"><img style="aspect-ratio:892/675;" src="Mind Map_image.png" width="892" height="675"></figure>

> [!IMPORTANT]
> Spreadsheets are a new type of note introduced in v0.103.0 and are currently considered experimental/beta.

The mind map allows for easy jotting down of ideas and storing them in a hierarchical fashion.

## Terminology

*   A **node** is a single idea…
*   The **root node** is…

## Interaction

*   To create a new node at the same level as the current one, press <kbd>Enter</kbd> or…
*   To delete a node, …

## Embedding notes
…

## Supported features / Limitations

### Share functionality
### Mobile support
```

## Collection page (`Collections/Kanban Board.md`, `Table.md`, `Grid View.md`, `Presentation.md`)

```markdown
# Kanban Board
<figure class="image image-style-align-center"><img …></figure>

The Board view presents sub-notes in columns for a Kanban-like experience…

## Creating a Kanban board

Right click on an existing note in the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_ and look for _Kanban Board_.

## How it works
…

## Interaction

### Working with columns
### Working with notes
### Keyboard interaction

## Configuration

### Grouping by another label

…the `#board:groupBy` label…

## Limitations

## Use in search
```

## UI-element page (`UI Elements/Split View.md`, `Right Sidebar.md`, `Floating buttons.md`, `Zoom.md`)

```markdown
# Split View
<figure class="image image-style-align-right image_resized" style="width:50%;"><img …></figure>

In Trilium, it's possible to display two notes side-by-side…

## Interaction

*   To open a split view, press the <span class="tn-icon bx bx-dock-right"></span> button to the right of a note's title.
*   To close a split view, …

## Mobile support

Since v0.100.0, …

## Keyboard shortcuts

*   <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>…</kbd>: _Create New Split_.
```

## Settings-driven section (inside `Content width.md`, `Personalizing the font.md`)

```markdown
## Adjusting the content width

Go to&nbsp;<a class="reference-link" href="../Options.md">Options</a>&nbsp;→ _Appearance_ → _Content Width_ and adjust the _Max content width_ option.

## Adjusting at note level

Manually apply the `fullContentWidth` [label](../../../Advanced%20Usage/Attributes/Labels.md) to a note…
```

## Concept page (`Collections.md`, `Note Types.md`, `Attributes/Labels.md`, `Notes/Cloning Notes.md`)

```markdown
# Labels
A label is an [attribute](../Attributes.md) of a note which has a name and optionally a value.

## Common labels for basic functionality

| Label | Description |
| --- | --- |
| `disableVersioning` | Disables automatic creation of… |

## Creating a label
…

## Configuration / Advanced use cases

### …

## Under the hood

Collections don't store their configuration … but as attachments.
```

## Installation / how-to page (`Desktop Installation.md`, `Using Docker.md`, `Backup.md`)

```markdown
# Using Docker
Official docker images are published on Docker Hub for…

## Prerequisites
…

## Running with Docker Compose

1.  **Download the Latest Release**: Obtain the latest `docker-compose.yml`…
2.  **Start the container**:
    
    ```sh
    docker compose up -d
    ```

> [!TIP]
> It's generally a good idea to use a reverse proxy…
```

## Breaking-change page (`Scripting/Breaking changes/v0.106.0 Removal of cheerio.md`)

```markdown
# v0.106.0: Removal of cheerio
Starting with v0.106.0, `cheerio` is no longer available in the backend script API.

## Reasoning
…

## Migration

### Parsing HTML

Before (cheerio):

```javascript
…
```

After:

```javascript
…
```
```

The title carries a colon; the file name drops it (`v0.106.0 Removal of cheerio.md`), which the
exporter does on its own.

## Relocation stub

When a page moves to a different home and the old noteId is referenced from code:

```markdown
# Old title
> [!NOTE]
> This page has been relocated to&nbsp;<a class="reference-link" href="../New%20Home.md">New Home</a>.
```

A `*.clone.md` file ("This is a clone of a note. Go to its [primary location](…).") is written by the
exporter for a cloned note and is never hand-written.
