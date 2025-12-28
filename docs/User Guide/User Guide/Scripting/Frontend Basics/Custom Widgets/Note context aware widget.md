# Note context aware widget
Note context-aware widgets are a different type of widget which automatically react to changes in the current note.

Important aspects:

*   The widget must export a `class` and not an instance of the class (e.g. `no new`) because it needs to be multiplied for each note, so that splits work correctly.
*   Since the `class` is exported instead of an instance, the `parentWidget` getter must be `static`, otherwise the widget is ignored.

## Example displaying the current note title

This is a note context-aware widget that simply displays the name the current note. 

### Classic example

```
class HelloNoteDetail extends api.NoteContextAwareWidget {

    constructor() {
        super();
        this.contentSized();
    }

    doRender() {
        this.$widget = $("<div>");
    }

    async refreshWithNote(note) {
        this.$widget.text("Current note: " + note.title);
    }
    
    static get parentWidget() { return "note-detail-pane" }    
    get position() { return 10 }
    
}

module.exports = HelloNoteDetail;
```

### Preact (v0.101.0+)

```
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