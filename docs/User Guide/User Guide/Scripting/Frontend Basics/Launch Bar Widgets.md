# Launch Bar Widgets
Launch bar widgets are a subset of <a class="reference-link" href="Custom%20Widgets.md">Custom Widgets</a> that can be used to render custom buttons and widgets inside the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.

## Creating a launch bar widget

Unlike <a class="reference-link" href="Custom%20Widgets.md">Custom Widgets</a>, the process of setting up a launch bar widget is slightly different:

1.  Create a Code note of type _JavaScript (front-end)_.
    *   The script itself uses the same concepts as <a class="reference-link" href="Custom%20Widgets.md">Custom Widgets</a>, including the use of a `NoteContextAwareWidget` or a `BasicWidget` (according to needs).
    *   As examples, see <a class="reference-link" href="Launch%20Bar%20Widgets/Note%20Title%20Widget.md">Note Title Widget</a> and <a class="reference-link" href="Launch%20Bar%20Widgets/Analog%20Watch.md">Analog Watch</a>.
2.  Don't set `#widget`, as that attribute is reserved for <a class="reference-link" href="Custom%20Widgets.md">Custom Widgets</a>.
3.  In the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>, select _Configure launchbar_.
4.  In the _Visible Launchers_ section, select _Add a custom widget_.
5.  Give the newly created launcher a name (and optionally a name).
6.  In the <a class="reference-link" href="../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> section, modify the _widget_ field to point to the newly created note.
7.  Refresh the UI.