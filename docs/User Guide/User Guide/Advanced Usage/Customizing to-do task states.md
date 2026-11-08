# Customizing to-do task states
Trilium features customizable to-do list task states. To customize them, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ → _Related settings_ → _Custom checkbox states for to-do lists_. Alternatively, right-click a checkbox in an editable text note and click the pencil icon; on the <a class="reference-link" href="../Installation%20%26%20Setup/Mobile%20Frontend.md">Mobile Frontend</a>, the pencil icon is in the row of the _List ›_ button of a to-do list.

> [!WARNING]
> Changes take effect only after restarting the application.

## Creating a new task state

Click the plus icon next to Task States in the left-side pane, then define the task details as described in the next section.

## Editing a task state

Selecting any state other than "None" and "Done" (which cannot be modified) from the side pane reveals the following editable fields:

*   _Icon_ (required): The symbol shown inside the checkbox. You can pick an icon just as you would for any regular note, including from custom icon packs.
*   _Title_ (required): The name of the task state shown in the UI. For example: "Doing", "Postponed".
*   _Identifier_ (required): A short name for the state, using only letters, digits, "`-`" and "`_`". It is stored as metadata in the note's markup and used to identify the task state. Two task states cannot share the same identifier.  
    Prefix the identifiers of your custom task states with an underscore "`_`" or a hyphen "`-`" to avoid clashes with task states that may be introduced in future versions of Trilium.
*   _Markdown symbol_: A single character used to represent the state in Markdown syntax. For example, "`#`" creates a task state that can be applied in Markdown using " `- [#]` ". Make sure no other task state uses the same symbol.
*   _Counts as completed_: If checked, the task is treated as completed.
*   _Color_: The color of the checkbox. Its lightness and saturation are adjusted automatically to match the current color scheme or theme.
*   _Hidden from toolbar_: The state is not listed in the UI. This is useful when you want existing notes to keep rendering the state correctly but no longer need to apply it yourself.

> [!NOTE]
> The task definition details are validated at startup. If errors are found, a toast provides the details and the affected task definition is ignored.

## Reordering task states

To change the order in which task states appear in the UI and when cycling through them with the keyboard, simply reorder the states in the side pane (or tree panel, if it's the case).

## Deleting task states

Any task state other than "None" and "Done" can be deleted.

Once deleted, to-do items using that state will no longer display the custom checkbox. They fall back to either a "None" or "Done" state, depending on the state's "Counts as completed" setting. The identifier and title remain stored in the note until you set the checkbox to a new state.

## Transferring notes with custom task states between Trilium database instances

Exporting notes to another Trilium database instance preserves the task states of to-do items, but does not include the custom task definitions. As a result, the destination instance won't know how to render the checkbox unless you recreate the task state there with the same identifier and Markdown symbol.

> [!NOTE]
> This is a known limitation of the current version. If there is enough interest in the community for transferring notes between Trilium database instances more easily, the Trilium team may consider a better state definition mechanism.