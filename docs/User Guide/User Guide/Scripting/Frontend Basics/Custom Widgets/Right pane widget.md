# Right pane widget
## Key highlights

*   `doRender` must not be overridden, instead `doRenderBody()` has to be overridden.
    *   `doRenderBody` can optionally be `async`.
*   `parentWidget()` must be set to `“rightPane”`.
*   `widgetTitle()` getter can optionally be overriden, otherwise the widget will be displayed as “Untitled widget”.

## Example for new layout

> [!IMPORTANT]
> This section addresses example that are tailored for the <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a> (available starting with v0.101.0) where the right pane widget/sidebar is no longer shown or hidden based on the widgets it has. 

### Title widget

This is an example of a context-aware widget which displays the title of the current note:

```
class NoteTitleWidget extends api.RightPanelWidget {
    
    get widgetTitle() { return "Note title"; }
    get parentWidget() { return "right-pane" }

    doRenderBody() {
        this.$body.empty();
        if (this.note) {
            this.$body.append($("<div>").text(this.note.title));
        }
    }   
    
    async refreshWithNote() {
    	this.doRenderBody();
    }
}

module.exports = new NoteTitleWidget();
```

### Clock

A simple widget which will show the current time, as an example on how to dynamically change the content of the widget periodically.

### Legacy widget

```
const template = `<div></div>`;

class ToDoListWidget extends api.RightPanelWidget {
    
    get widgetTitle() { return "Clock"; }        
    get parentWidget() { return "right-pane" }
    
    async doRenderBody() {
        if (!this.timer) {
            this.timer = setInterval(() => {
                this.$body.empty().append(`The time is: <span>${new Date().toLocaleString()}</span>`);                       
            }, 1000);            
        }

        this.$body.empty().append(`The time is: <span>${new Date().toLocaleString()}</span>`);
    }   
}

module.exports = new ToDoListWidget();
```

### Preact widget

```
import { defineWidget, RightPanelWidget, useEffect, useState } from "trilium:preact";

export default defineWidget({
    parent: "right-pane",    
    position: 1,
    render() {
        const [ time, setTime ] = useState();
        useEffect(() => {
            const interval = setInterval(() => {
                setTime(new Date().toLocaleString());
            }, 1000);
            return () => clearInterval(interval);
        });        
        return (
            <RightPanelWidget id="clock-jsx" title="Clock (JSX)">
                <p>The time is: {time}</p>
            </RightPanelWidget>
        );
    }
});
```

## Example for old layout

Here's a widget that displays a basic message ("Hi"):

```
const template = `<div>Hi</div>`;

class HelloWorldWidget extends api.RightPanelWidget {
    
    get widgetTitle() {
        return "Title goes here";
    }
        
    get parentWidget() { return "right-pane" }
    
    doRenderBody() {
        this.$body.empty().append($(template));
    }   
    
    async refreshWithNote(note) {
    	// Do something when the note changes.
    }
}

module.exports = new HelloWorldWidget();
```

### Conditionally changing visibility

In `refreshWithNote`:

```
const visible = true;	// replace with your own visibility logic
this.toggleInt(visible);
this.triggerCommand("reEvaluateRightPaneVisibility");
```

## Altering the position within the sidebar

By default, the sidebar items are displayed in the order they are found by the application when searching for `#widget` notes.

It is possible to make a widget appear higher or lower up, by adjusting its `position` property:

```
class MyWidget extends api.RightPanelWidget {

+    get position() { return 20 };
        
}
```

Generally the default position starts from 10 and increases by 10 with each item, including the default Table of Contents and Highlights list.