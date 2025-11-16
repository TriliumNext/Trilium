# Right pane widget
*   `doRender` must not be overridden, instead `doRenderBody()` has to be overridden.
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
        this.toggleInt(false);                
        this.triggerCommand("reEvaluateRightPaneVisibility");
        this.toggleInt(true);
        this.triggerCommand("reEvaluateRightPaneVisibility");
    }
}

module.exports = new ToDoListWidget();
```

The implementation is in `src/public/app/widgets/right_panel_widget.js`.