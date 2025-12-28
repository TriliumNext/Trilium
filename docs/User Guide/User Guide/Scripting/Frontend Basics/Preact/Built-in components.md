# Built-in components
<figure class="image image_resized" style="width:54.58%;"><img style="aspect-ratio:896/712;" src="Built-in components_image.png" width="896" height="712"><figcaption>A partial screenshot from the Widget showcase example (see below).</figcaption></figure>

Trilium comes with its own set of Preact components, some of which are also available to <a class="reference-link" href="../Custom%20Widgets.md">Custom Widgets</a> and <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a>.

To use these components, simply import them from `trilium:preact`:

```jsx
import { ActionButton, Button, LinkButton } from "trilium:preact";
```

and then use them:

```jsx
export default function MyRenderNote() {
    const onClick = () => showMessage("A button was pressed");
    
    return (
        <>
            <h2>Buttons</h2>
            <div style={{ display: "flex", gap: "1em", alignItems: "center" }}>
                <ActionButton icon="bx bx-rocket" text="Action button" onClick={onClick} />
                <Button icon="bx bx-rocket" text="Simple button" onClick={onClick} />
                <LinkButton text="Link button" onClick={onClick} />                
            </div>
        </>
    )
}
```

## Widget showcase

> [!TIP]
> Starting with v0.101.0, the widget showcase is also available in the <a class="reference-link" href="../../../Advanced%20Usage/Database/Demo%20Notes.md">Demo Notes</a>.

This is a <a class="reference-link" href="../../../Note%20Types/Render%20Note.md">Render Note</a> example with JSX that shows most of the built-in components that are accessible to custom widgets and JSX render notes.

To use it, simply:

1.  Create a render note.
2.  Create a child code note of JSX type with the content of this file: <a class="reference-link" href="Built-in%20components/Widget%20showcase.jsx">Widget showcase</a>
3.  Set the `~renderNote` relation of the parent note to the child note.
4.  Refresh the render note to see the results.