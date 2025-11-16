# Frontend Basics
## Frontend API

The frontend api supports two styles, regular scripts that are run with the current app and note context, and widgets that export an object to Trilium to be used in the UI. In both cases, the frontend api of Trilium is available to scripts running in the frontend context as global variable `api`. The members and methods of the api can be seen on the [Script API](Script%20API.md) page.

## Scripts

Scripts don't have any special requirements. They can be run at will using the execute button in the UI or they can be configured to run at certain times using [Attributes](../Advanced%20Usage/Attributes.md) on the note containing the script.

### Global Events

This attribute is called `#run` and it can have any of the following values:

*   `frontendStartup` - executes on frontend upon startup.
*   `mobileStartup` - executes on mobile frontend upon startup.
*   `backendStartup` - executes on backend upon startup.
*   `hourly` - executes once an hour on backend.
*   `daily` - executes once a day on backend.

### Entity Events

These events are triggered by certain [relations](../Advanced%20Usage/Attributes.md) to other notes. Meaning that the script is triggered only if the note has this script attached to it through relations (or it can inherit it).

*   `runOnNoteCreation` - executes when note is created on backend.
*   `runOnNoteTitleChange` - executes when note title is changed (includes note creation as well).
*   `runOnNoteContentChange` - executes when note content is changed (includes note creation as well).
*   `runOnNoteChange` - executes when note is changed (includes note creation as well).
*   `runOnNoteDeletion` - executes when note is being deleted.
*   `runOnBranchCreation` - executes when a branch is created. Branch is a link between parent note and child note and is created e.g. when cloning or moving note.
*   `runOnBranchDeletion` - executes when a branch is delete. Branch is a link between parent note and child note and is deleted e.g. when moving note (old branch/link is deleted).
*   `runOnChildNoteCreation` - executes when new note is created under this note.
*   `runOnAttributeCreation` - executes when new attribute is created under this note.
*   `runOnAttributeChange` - executes when attribute is changed under this note.

## Widgets

Conversely to scripts, widgets do have some specific requirements in order to work. A widget must:

*   Extend [BasicWidget](https://triliumnext.github.io/Notes/frontend_api/BasicWidget.html) or one of it's subclasses.
*   Create a new instance and assign it to `module.exports`.
*   Define a `parentWidget` member to determine where it should be displayed.
*   Define a `position` (integer) that determines the location via sort order.
*   Have a `#widget` attribute on the containing note.
*   Create, render, and return your element in the render function.
    *   For [BasicWidget](https://triliumnext.github.io/Notes/frontend_api/BasicWidget.html) and [NoteContextAwareWidget](https://triliumnext.github.io/Notes/frontend_api/NoteContextAwareWidget.html)you should create `this.$widget` and render it in `doRender()`.
    *   For [RightPanelWidget](https://triliumnext.github.io/Notes/frontend_api/RightPanelWidget.html) the `this.$widget` and `doRender()` are already handled and you should instead return the value in `doRenderBody()`.

### parentWidget

*   `left-pane` - This renders the widget on the left side of the screen where the note tree lives.
*   `center-pane` - This renders the widget in the center of the layout in the same location that notes and splits appear.
*   `note-detail-pane` - This renders the widget _with_ the note in the center pane. This means it can appear multiple times with splits.
*   `right-pane` - This renders the widget to the right of any opened notes.

### Tutorial

For more information on building widgets, take a look at [Widget Basics](Frontend%20Basics/Custom%20Widgets/Widget%20Basics.md).