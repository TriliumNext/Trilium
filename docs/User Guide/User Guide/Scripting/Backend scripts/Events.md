# Events
[Script](../../Scripting.md) notes can be triggered by events. Note that these are backend events and thus relation need to point to the "JS backend" code note.

## Global events

Global events are attached to the script note via label. Simply create e.g. "run" label with some of these values and script note will be executed once the event occurs.

<table><thead><tr><th>Label</th><th>Description</th></tr></thead><tbody><tr><td><code>run</code></td><td><p>Defines on which events script should run. Possible values are:</p><ul><li><code>frontendStartup</code> - when Trilium frontend starts up (or is refreshed), but not on mobile.</li><li><code>mobileStartup</code> - when Trilium frontend starts up (or is refreshed), on mobile.</li><li><code>backendStartup</code> - when Trilium backend starts up</li><li><code>hourly</code> - run once an hour. You can use additional label <code>runAtHour</code> to specify at which hour, on the back-end.</li><li><code>daily</code> - run once a day, on the back-end</li></ul></td></tr><tr><td><code>runOnInstance</code></td><td>Specifies that the script should only run on a particular&nbsp;<a class="reference-link" href="../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables)/Trilium%20instance.md">Trilium instance</a>.</td></tr><tr><td><code>runAtHour</code></td><td>On which hour should this run. Should be used together with <code>#run=hourly</code>. Can be defined multiple times for more runs during the day.</td></tr></tbody></table>

## Entity events

Other events are bound to some entity, these are defined as [relations](../../Advanced%20Usage/Attributes.md) - meaning that script is triggered only if note has this script attached to it through relations (or it can inherit it).

| Relation | Description |
| --- | --- |
| `runOnNoteCreation` | executes when note is created on backend. Use this relation if you want to run the script for all notes created under a specific subtree. In that case, create it on the subtree root note and make it inheritable. A new note created within the subtree (any depth) will trigger the script. |
| `runOnChildNoteCreation` | executes when new note is created under the note where this relation is defined |
| `runOnNoteTitleChange` | executes when note title is changed (includes note creation as well) |
| `runOnNoteContentChange` | executes when note content is changed (includes note creation as well). |
| `runOnNoteChange` | executes when note is changed (includes note creation as well). Does not include content changes |
| `runOnNoteDeletion` | executes when note is being deleted |
| `runOnBranchCreation` | executes when a branch is created. Branch is a link between parent note and child note and is created e.g. when cloning or moving note. |
| `runOnBranchChange` | executes when a branch is updated. (since v0.62) |
| `runOnBranchDeletion` | executes when a branch is deleted. Branch is a link between parent note and child note and is deleted e.g. when moving note (old branch/link is deleted). |
| `runOnAttributeCreation` | executes when new attribute is created for the note which defines this relation |
| `runOnAttributeChange` | executes when the attribute is changed of a note which defines this relation. This is triggered also when the attribute is deleted |