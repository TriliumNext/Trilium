# Hidden notes
## Disallow adding child notes

1.  To enforce at server level go to `services/notes.ts` and look for the `getAndValidateParent` method.  Look for the `params.ignoreForbiddenParents` if statement and add it there.
2.  To hide the plus button in the note tree, go to `widgets/note_tree` in the client and look for `enhanceTitle`. Look for the if statement which starts with `!["search", "launcher"].includes(note.type)`.
3.  To disable it from the contextual menu, go to `tree_context_menu` and look for the `getMenuItems` method. There look for the `insertNoteAfter` and `insertChildNote` actions and look at their `enabled` conditions. If adding a big note type with lots of child notes, see the pattern of optinos & help (rename and augment the `notOptionsOrHelp` variable.