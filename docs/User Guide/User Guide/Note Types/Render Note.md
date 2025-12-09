# Render Note
<figure class="image"><img style="aspect-ratio:601/216;" src="Render Note_image.png" width="601" height="216"></figure>

Render Note is used in <a class="reference-link" href="../Scripting.md">Scripting</a>. It works by displaying the HTML of a <a class="reference-link" href="Code.md">Code</a> note, via an attribute.

## Creating a render note

1.  Create a <a class="reference-link" href="Code.md">Code</a> note with the HTML language, with what needs to be displayed (for example `<p>Hello world.</p>`).
2.  Create a <a class="reference-link" href="Render%20Note.md">Render Note</a>.
3.  Assign the `renderNote` [relation](../Advanced%20Usage/Attributes.md) to point at the previously created code note.

## Dynamic content

A static HTML is generally not enough for <a class="reference-link" href="../Scripting.md">Scripting</a>. The next step is to automatically change parts of the note using JavaScript.

For a simple example, we are going to create a render note that displays the current date in a field.

To do so, first create an HTML code note with the following content:

```
<h1>Current date & time</h1>
The current date & time is <span class="date"></span>
```

Now we need to add the script. Create another <a class="reference-link" href="Code.md">Code</a>, but this time of JavaScript (frontend) language. Make sure the newly created note is a direct child of the HTML note created previously; with the following content:

```
const $dateEl = api.$container.find(".date");
$dateEl.text(new Date());
```

Now create a render note at any place and set its `~renderNote` relation to point to the HTML note. When the render note is accessed it will display:

> **Current date & time**  
> The current date & time is Sun Apr 06 2025 15:26:29 GMT+0300 (Eastern European Summer Time)

## Refreshing the note

It's possible to refresh the note via:

*   The corresponding button in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a>.
*   The “Render active note” [keyboard shortcut](../Basic%20Concepts%20and%20Features/Keyboard%20Shortcuts.md) (not assigned by default).

## Examples

*   <a class="reference-link" href="../Advanced%20Usage/Advanced%20Showcases/Weight%20Tracker.md">Weight Tracker</a> which is present in the <a class="reference-link" href="../Advanced%20Usage/Database/Demo%20Notes.md">Demo Notes</a>.