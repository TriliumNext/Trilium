# Right pane widget
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

=== "<span class="tn-icon bx bxl-react"></span> Preact"

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

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

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

## Altering the position within the sidebar

By default, the sidebar items are displayed in the order they are found by the application when searching for `#widget` notes.

It is possible to make a widget appear higher or lower up, by adjusting its `position` property:

=== "<span class="tn-icon bx bxl-react"></span> Preact"

    ```javascript
    import { defineWidget, RightPanelWidget, useEffect, useState } from "trilium:preact";

    export default defineWidget({
    	/* [...] */
        position: 20,
        render() {
    		/* [...] */
        }
    });
    ```

=== "<span class="tn-icon bx bxl-javascript"></span> Legacy"

    ```javascript
    class MyWidget extends api.RightPanelWidget {

        get position() { return 20 };
            
    }
    ```

Generally the default position starts from 10 and increases by 10 with each item, including the default Table of Contents and Highlights list.

## Key highlights for legacy widgets

*   `doRender` must not be overridden, instead `doRenderBody()` has to be overridden.
    *   `doRenderBody` can optionally be `async`.
*   `parentWidget()` must be set to `“rightPane”`.
*   `widgetTitle()` getter can optionally be overriden, otherwise the widget will be displayed as “Untitled widget”.