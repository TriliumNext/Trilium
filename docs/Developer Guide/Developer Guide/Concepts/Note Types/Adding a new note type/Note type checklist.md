# Note type checklist
The goal of this checklist is to ensure a good implementation or re-test of a note type.

## Implementation checklist

The note type widget must be created according to <a class="reference-link" href="First%20steps.md">First steps</a>:

*   Register the note type in the server
*   Register the note type in the client context menu
*   Create a type widget
*   Register the type widget
*   Add the default icon mapping
*   Add to note type selector
*   Add the note to server allowed note types
*   Update demo document to include this new note type
*   Increase server sync version (see <a class="reference-link" href="#root/XPSyrTI07rbd/DrIXfwu9CVJP">Mindmap gets turned as file</a>).

## Validation checklist

### Ensure that the note renders properly

*   When refreshing to a note that is already displayed
*   When going to another note and then going back
*   When creating a new note of the given type
*   Have two tabs of the same note type and switch between them

### Ensure data persistence

*   Save data when modifying changes via spaced update

### Ensure data retrieval

*   Go on a note of this type and refresh the page
*   Create a new note of this type while on another note of this type and ensure that the content is set properly.

### Set up a note preview

For an implementation reference, see <a class="reference-link" href="SVG%20rendering.md">SVG rendering</a>.

*   Note preview rendering (go to parent and see note list).
*   Include note
*   Share
*   Note revisions

### Import/export

*   Export & Import, making sure no data is lost in the process.
*   Remove the data folder entirely to test that the demo document is well imported on first setup.
    *   Ensure that the preview also works (check the preview in the root note).