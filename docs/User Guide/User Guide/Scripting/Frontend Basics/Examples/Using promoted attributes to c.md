# Using promoted attributes to configure scripts
A good use case of promoted attributes is to easily define the various parameters a script might need, for example an input and output note if it's processing data, or a checkbox to define a particular change in behavior for the script.

![](Using%20promoted%20attributes%20.png)

## Using check boxes to toggle flags

Instead of asking the user to modify a boolean value in the script, it's much more intuitive to use a checkbox for it as a promoted attribute.

To do so, first define the promoted attribute:

```
#label:groupByExtension="promoted,alias=Group by extension,single,boolean"
```

Then use it:

```javascript
const byExtension = api.currentNote.getLabelValue("groupByExtension") === "true";
if (byExtension) {
	// Do something.
}
```

This will work equally well in both front-end and back-end scripts.

## Using relations to select notes

One common use case for a script is to read data from another note and perhaps output its result in another note. To do so we need to define the following promoted attributes:

```
#relation:input="promoted,alias=Input,single" #relation:output="promoted,alias=Output,single"
```

Once we have this, we can add some basic error handling to ensure that the fields are completed by the user:

```javascript
const inputNoteId = api.currentNote.getRelationValue("input");
if (!inputNoteId) {
	api.showError("Missing input.");
    return;
}

const outputNoteId = api.currentNote.getRelationValue("output");
if (!outputNoteId) {
    api.showError("Missing output.");
    return;
}
```

Note that here we are using `api.showError` which is only available for frontend notes. If you are writing a backend note, simply remove `api.showError` but the user will no feedback on why the script did not execute properly.

Afterwards we can simply read the note and do something with it:

```javascript
const note = api.getNote(inputNoteId);
if (!note) {
	return;
}
const content = note.getContent().toString("utf-8");
```