# Note Title Widget
<figure class="image"><img style="aspect-ratio:1007/94;" src="Note Title Widget_image.png" width="1007" height="94"></figure>

This is an example of a note context-aware widget, which reacts to the currently opened note and refreshes automatically as the user navigates through the notes.

## Legacy widget

In this example, the title of the note is displayed. It works best on the [horizontal layout](../../../Basic%20Concepts%20and%20Features/UI%20Elements/Vertical%20and%20horizontal%20layout.md).

```javascript
const TPL = `\
<div style="
    display: flex;
    height: 53px;
    width: fit-content;
    font-size: 0.75em;
    contain: none;
    align-items: center;
    flex-shrink: 0;
    padding: 0 1em;
"></div>`;

class NoteTitleWidget extends api.NoteContextAwareWidget {
    doRender() {
        this.$widget = $(TPL);
    }

    async refreshWithNote(note) {
        this.$widget.text(note.title);
    }
}

module.exports = new NoteTitleWidget();
```

## Preact widget (v0.101.0+)

```jsx
import { defineLauncherWidget, useActiveNoteContext } from "trilium:preact";

export default defineLauncherWidget({
    render: () => {
        const { note } = useActiveNoteContext();
        return <div style={{
            display: "flex",
            height: "53px",
            width: "fit-content",
            fontSize: "0.75em",
            alignItems: "center",
            flexShrink: 0            
        }}>{note?.title}</div>;
    }
});
```