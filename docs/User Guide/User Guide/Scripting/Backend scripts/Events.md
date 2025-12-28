# Events
[Script](../../Scripting.md) notes can be triggered by events. Note that these are backend events and thus relation need to point to the "JS backend" code note.

## Global events

Global events are attached to the script note via label. Simply create e.g. "run" label with some of these values and script note will be executed once the event occurs.

<table><thead><tr><th>Label</th><th>Description</th></tr></thead><tbody><tr><td><code>run</code></td><td><p>Defines on which events script should run. Possible values are:</p><ul><li data-list-item-id="e244b14e102cf1b0d4954e8fd455ea77b"><code>frontendStartup</code> - when Trilium frontend starts up (or is refreshed), but not on mobile.</li><li data-list-item-id="ea8f8ca86e7b351dd86108848ccb9103a"><code>mobileStartup</code> - when Trilium frontend starts up (or is refreshed), on mobile.</li><li data-list-item-id="e658488cf1a0862603088ef384e41b8b6"><code>backendStartup</code> - when Trilium backend starts up</li><li data-list-item-id="ef40ba992fc450d33a18ca4cb031eca66"><code>hourly</code> - run once an hour. You can use additional label <code>runAtHour</code> to specify at which hour, on the back-end.</li><li data-list-item-id="e07458d4f55b6eb42468a5535b8425c5f"><code>daily</code> - run once a day, on the back-end</li></ul></td></tr><tr><td><code>runOnInstance</code></td><td>Specifies that the script should only run on a particular&nbsp;<a class="reference-link" href="../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables)/Trilium%20instance.md">Trilium instance</a>.</td></tr><tr><td><code>runAtHour</code></td><td>On which hour should this run. Should be used together with <code>#run=hourly</code>. Can be defined multiple times for more runs during the day.</td></tr></tbody></table>

## Entity events

Other events are bound to some entity, these are defined as [relations](../../Advanced%20Usage/Attributes.md) - meaning that script is triggered only if note has this script attached to it through relations (or it can inherit it).

| Relation | Trigger condition | Origin entity (see below) |
| --- | --- | --- |
| `runOnNoteCreation` | executes when note is created on backend. Use this relation if you want to run the script for all notes created under a specific subtree. In that case, create it on the subtree root note and make it inheritable. A new note created within the subtree (any depth) will trigger the script. | The `BNote` that got created. |
| `runOnChildNoteCreation` | executes when new note is created under the note where this relation is defined | The `BNote` of the child that got created. |
| `runOnNoteTitleChange` | executes when note title is changed (includes note creation as well) | The `BNote` of the note whose title got changed. |
| `runOnNoteContentChange` | executes when note content is changed (includes note creation as well). | The `BNote` of the note whose content got changed. |
| `runOnNoteChange` | executes when note is changed (includes note creation as well). Does not include content changes | The `BNote` of the note that got changed. |
| `runOnNoteDeletion` | executes when note is being deleted | The `BNote` of the note that got (soft) deleted. |
| `runOnBranchCreation` | executes when a branch is created. Branch is a link between parent note and child note and is created e.g. when cloning or moving note. | The `BBranch` that got created. |
| `runOnBranchChange` | executes when a branch is updated. (since v0.62) | The `BBranch` that got changed. |
| `runOnBranchDeletion` | executes when a branch is deleted. Branch is a link between parent note and child note and is deleted e.g. when moving note (old branch/link is deleted). | The `BBranch` that got (soft) deleted. |
| `runOnAttributeCreation` | executes when new attribute is created for the note which defines this relation | The `BAttribute` that got created. |
| `runOnAttributeChange` | executes when the attribute is changed of a note which defines this relation. This is triggered also when the attribute is deleted | The `BAttribute` that got changed. |

## Origin entity

When a script is run by an event such as the ones described above, `api.originEntity` will get populated with the note, branch or attribute that triggered the change.

For example, here's a script with `~runOnAttributeChange` which automatically changes the color of a note based on the value of the `mycategory` label:

```javascript
const attr = api.originEntity;
if (attr.name !== "mycategory") return;
const note = api.getNote(attr.noteId);
if (attr.value === "Health") {
    note.setLabel("color", "green");
} else {
    note.removeLabel("color");
}
```