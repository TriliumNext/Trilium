# Hooks
## Standard Preact hooks

All standard Preact hooks are available as an import in `trilium:api`.

For example:

```jsx
import { useState } from "trilium:preact";
const [ myState, setMyState ] = useState("Hi");
```

## Custom hooks

Trilium comes with a large set of custom hooks for Preact, all of which are also available to custom widgets and <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a>.

### `useNoteContext`

As a replacement to <a class="reference-link" href="../Custom%20Widgets/Note%20context%20aware%20widget.md">Note context aware widget</a>, Preact exposes the current note context in the `useNoteContext` hook:

```jsx
import { defineWidget, useNoteContext, useNoteProperty } from "trilium:preact";

export default defineWidget({    
    parent: "note-detail-pane",
    position: 10,
    render: () => {
        const { note } = useNoteContext();
        const title = useNoteProperty(note, "title");
        return <span>Current note JSX: {title}</span>;
    }
});
```

Note that the custom widget must be inside the content area (so note detail widget) for this to work properly, especially when dealing with splits.

### `useActiveNoteContext`

`useActiveNoteContext` is an alternative to `useNoteContext` which works even if the widget is not within the note detail section and it automatically switches the note context as the user is navigating around between tabs and splits.

### `useNoteProperty`

This hook allows “listening” for changes to a particular property of a `FNote`, such as the `title` or `type` of a note. The benefit from using the hook is that it actually reacts to changes, for example if the note title or type is changed.