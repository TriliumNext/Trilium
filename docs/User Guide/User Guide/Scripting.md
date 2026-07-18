# Scripting
Trilium supports creating <a class="reference-link" href="Note%20Types/Code.md">Code</a> notes, i.e. notes which allow you to store some programming code and highlight it. Special case is JavaScript code notes which can also be executed inside Trilium which can in conjunction with <a class="reference-link" href="Scripting/Script%20API.md">Script API</a> provide extra functionality.

## Architecture Overview

To go further I must explain basic architecture of Trilium - in its essence it is a classic web application - it has these two main components:

*   frontend running in the browser (using HTML, CSS, JavaScript) - this is mainly used to interact with the user, display notes etc.
*   backend running JavaScript code in node.js runtime - this is responsible for e.g. storing notes, encrypting them etc.

So we have frontend and backend, each with their own set of responsibilities, but their common feature is that they both run JavaScript code. Add to this the fact, that we're able to create JavaScript <a class="reference-link" href="Note%20Types/Code.md">Code</a> and we're onto something.

## Use cases

*   <a class="reference-link" href="Scripting/Frontend%20Basics/Examples/New%20Task%20launcher%20button.md">"New Task" launcher button</a>

## Action handler

Saving the note to the database is backend's responsibility, so we immediately pass control to the backend and ask it to create a note. Once this is done, we show the newly created note so that the user can set the task title and maybe some attributes.

## Script execution

So we have a script which will add the button to the toolbar. But how can we execute it? One possibility is to click on "play" icon (marked by red circle). The problem with this is that this UI change is time bound by Trilium runtime so when we restart Trilium, button won't be there.

We need to execute it every time Trilium starts up, but we probably don't want to have to manually click on play button on every start up.

The solution is marked by red circle at the bottom - this note has [label](Advanced%20Usage/Attributes.md) `#run=frontendStartup` - this is one of the "system" labels which Trilium understands. As you might guess, this will cause all such labeled script notes to be executed once Trilium frontend starts up.

(`#run=frontendStartup` does not work for [Mobile frontend](Installation%20%26%20Setup/Mobile%20Frontend.md) - if you want to have scripts running there, give the script `#run=mobileStartup` label).

### Execute button

Runnable code notes (frontend or backend) and saved SQL consoles can optionally have a dedicated execute button alongside a description.

To do so, apply the following [labels](Advanced%20Usage/Attributes/Labels.md):

*   A `#executeButton` with the value of the label being displayed as the label of the button.
*   An optional `#executeDescription` which adds explanatory text beside it.

## Autocomplete & linting

Starting with Trilium v0.104.0, frontend scripts, backend scripts and render notes benefit from an autocomplete system.

The autocomplete triggers automatically when typing <kbd>.</kbd> or manually by pressing <kbd>Ctrl</kbd>+<kbd>Space</kbd>.

In addition to that, the editor will also display syntax errors and warnings such as unreachable code.

> [!NOTE]
> If you notice a false positive in regards with the errors/warnings reported or an incorrect or missing API, feel free to [open a issue](Troubleshooting/Reporting%20issues.md) with a code sample.

## More showcases

You can see more scripting with explanation in <a class="reference-link" href="Advanced%20Usage/Advanced%20Showcases.md">Advanced Showcases</a>.

## Events

See <a class="reference-link" href="Scripting/Backend%20scripts/Events.md">Events</a>.

## Script API

See <a class="reference-link" href="Scripting/Script%20API.md">Script API</a>.