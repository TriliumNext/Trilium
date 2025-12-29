# Custom Widgets
Custom widgets are a special subset of scripts that render graphical elements in certain parts of the application. These can be used to add new functionality to the Trilium application.

## Preact with JSX vs. vanilla jQuery

In older versions of Trilium, custom widgets were exclusively written in a combination of jQuery with Trilium's internal widget architecture (e.g., `BasicWidget`, `NoteContextAwareWidget`).

Starting with v0.101.0, custom widgets can also be written in JSX using the <a class="reference-link" href="Preact.md">Preact</a> framework. Both legacy and Preact widgets have the same capabilities, with a single difference:

*   Preact widgets are content-sized by default whereas legacy widgets need `this.contentSized()` applied in the constructor. For more information, see the corresponding section in <a class="reference-link" href="Custom%20Widgets/Troubleshooting.md">Troubleshooting</a>.

Wherever possible, widget examples will be both in the legacy and Preact format.

## Creating a custom widget

1.  Create a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note.
2.  Set the language to:
    1.  JavaScript (frontend) for legacy widgets using jQuery.
    2.  JSX for Preact widgets. You might need to go to Options → Code to enable the language first.
3.  Apply the `#widget` [label](../../Advanced%20Usage/Attributes/Labels.md).

## Getting started with a simple example

Let's start by creating a widget that shows a message near the content area. Follow the previous section to create a code note, and use the following content.

### Legacy version (jQuery)

```
class HelloCenterPane extends api.BasicWidget {

    constructor() {
        super();
        this.contentSized();
    }

    get parentWidget() { return "center-pane" }

    doRender() {
        this.$widget = $("<span>Center pane</span>");
    }
    
}

module.exports = new HelloCenterPane();
```

[Refresh the application](../../Troubleshooting/Refreshing%20the%20application.md) and the widget should appear underneath the content area.

### Preact version

```
import { defineWidget } from "trilium:preact";

export default defineWidget({
    parent: "center-pane",
    render: () => <span>Center pane from Preact.</span>
});
```

[Refresh the application](../../Troubleshooting/Refreshing%20the%20application.md) and the widget should appear underneath the content area.

## Widget location (parent widget)

A widget can be placed in one of the following sections of the applications:

<table class="ck-table-resized"><colgroup><col style="width:15.59%;"><col style="width:30.42%;"><col style="width:16.68%;"><col style="width:37.31%;"></colgroup><thead><tr><th>Value for <code>parentWidget</code></th><th>Description</th><th>Sample widget</th><th>Special requirements</th></tr></thead><tbody><tr><th><code>left-pane</code></th><td>Appears within the same pane that holds the&nbsp;<a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>.</td><td>Same as above, with only a different <code>parentWidget</code>.</td><td>None.</td></tr><tr><th><code>center-pane</code></th><td>In the content area. If a split is open, the widget will span all of the splits.</td><td>See example above.</td><td>None.</td></tr><tr><th><code>note-detail-pane</code></th><td><p>In the content area, inside the note detail area. If a split is open, the widget will be contained inside the split.</p><p>This is ideal if the widget is note-specific.</p></td><td><a class="reference-link" href="Custom%20Widgets/Note%20context%20aware%20widget.md">Note context aware widget</a></td><td><ul><li data-list-item-id="ec06332efcc3039721606c052f0d913fa">The widget must export a <code>class</code> and not an instance of the class (e.g. <code>no new</code>) because it needs to be multiplied for each note, so that splits work correctly.</li><li data-list-item-id="e8da690a2a8df148f6b5fc04ba1611688">Since the <code>class</code> is exported instead of an instance, the <code>parentWidget</code> getter must be <code>static</code>, otherwise the widget is ignored.</li></ul></td></tr><tr><th><code>right-pane</code></th><td>In the&nbsp;<a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>, as a dedicated section.</td><td><a class="reference-link" href="Custom%20Widgets/Right%20pane%20widget.md">Right pane widget</a></td><td><ul><li data-list-item-id="efe008d361e224f422582552648e1afe7">Although not mandatory, it's best to use a <code>RightPanelWidget</code> instead of a <code>BasicWidget</code> or a <code>NoteContextAwareWidget</code>.</li></ul></td></tr></tbody></table>

To position the widget somewhere else, just change the value passed to `get parentWidget()` for legacy widgets or the `parent` field for Preact. Do note that some positions such as `note-detail-pane` and `right-pane` have special requirements that need to be accounted for (see the table above).

## Launch bar widgets

Launch bar widgets are similar to _Custom widgets_ but are specific to the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>. See <a class="reference-link" href="Launch%20Bar%20Widgets.md">Launch Bar Widgets</a> for more information.

## Custom position