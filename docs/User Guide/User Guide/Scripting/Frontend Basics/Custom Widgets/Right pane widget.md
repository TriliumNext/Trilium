# Right pane widget
*   `doRender` must not be overridden, instead `doRenderBody()` has to be overridden.
    *   `doRenderBody` can optionally be `async`.
*   `parentWidget()` must be set to `“rightPane”`.
*   `widgetTitle()` getter can optionally be overriden, otherwise the widget will be displayed as “Untitled widget”.

```
const template = `<div>Hi</div>`;

class ToDoListWidget extends api.RightPanelWidget {
    
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

module.exports = new ToDoListWidget();
```

The implementation is in `src/public/app/widgets/right_panel_widget.js`.

## Conditionally changing visibility

In `refreshWithNote`:

```
const visible = true;	// replace with your own visibility logic
this.toggleInt(visible);
this.triggerCommand("reEvaluateRightPaneVisibility");
```