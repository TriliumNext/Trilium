# First steps
> **Note**: When adding or updating step titles/order, don't forget to update the corresponding list in <a class="reference-link" href="Note%20type%20checklist.md">Note type checklist</a>.

## Step 1. Register the note type in the server

Go to `src\services\note_types.ts` and add a new entry in `noteTypes` with the type ID and the default MIME type.

## Step 2. Register the note type in the client context menu

The client lists the available note types in `src\public\app\services\note_types.ts`.

## Step 3. Create a type widget

Go to `src\public\app\widgets\type_widgets` directory and create a new file corresponding to the new note type.

A blank implementation looks something like this:

## Step 4. Register the type widget

The type widget needs to go in `src\public\app\widgets\note_detail.ts`where there is a `typeWidgetClasses` map, mapping the type IDs with the corresponding type widget that was created at the previous step.

## Step 5. Add the default icon mapping

To set a default icon for this note type, go to `src\public\app\entities\fnote.ts` and add it to `NOTE_TYPE_ICONS`.

## Step 6. Add to note type selector

Go to `src/public/app/widgets/note_type.ts` and register the new note type in `NOTE_TYPES`.

## Step 7. Add the note to server allowed note types

This is required in order to make imports possible, otherwise they will be imported as plain text.

Go to `src/becca/entities/rows.ts` and add the new note type to `ALLOWED_NOTE_TYPES`.

## Additional changes

*   If the widget requires a full height, it must be configured in `src\public\app\widgets\note_detail.ts` (look for `checkFullHeight`) then a `height: 100%` style can be applied to the containers to make them fit.
*   To make the note always full width (ignoring the user's content width), go to `note_wrapper` and look for the `refresh` method. There is a `toggleClass` for `full-content-width` based on the note type.
*   To allow the note source to be viewed, go to `src/public/app/widgets/buttons/note_actions.ts` and look for `this.toggleDisabled(this.$showSourceButton` in `refreshVisibility`.

## Final steps

*   Update the <a class="reference-link" href="../../Demo%20document.md">Demo document</a> to showcase the new note type.

## Troubleshooting

### Content does not appear, however it appears as hidden in the DOM

Type widgets do a check whenever a note is selected to determine whether the widget needs to be displayed or not, based on the note type. Make sure `getType()` is well implemented in the newly added type widget (take great care that the value is returned but also that the note type ID matches the ones registered in the previous steps):

```
static getType() { return "foo"; }
```