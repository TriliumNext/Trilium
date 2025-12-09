# Demo document
The demo document is an exported .zip that resides in `apps/server/src/assets/db/demo.zip`.

During on-boarding, if the user selects that they are a new user then the `demo.zip` is imported into the root note.

## Modifying the document

1.  In the Git root, run `pnpm edit-docs:edit-demo`.
2.  Wait for the desktop application to show up with the docs.
3.  Simply make the needed modifications.
4.  Wait for a few seconds for the change to be processed in the background.
5.  Commit the change in Git.

## Testing the changes

1.  Run:
    
    ```
    rm -r data
    pnpm server:start
    ```
2.  And then do the on-boarding again.