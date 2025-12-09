# Guidelines
*   Use hierarchy whenever appropriate, try to group the messages by:
    *   Modals (e.g. `about.foo`, `jump_to_note.foo`)
*   Don't duplicate messages that are very widely used.
    *   One such example is `aria-label="Close"` which should go to a single message such as `modal.close` instead of being duplicated in every modal.
*   On the other hand, don't overly generalise messages. A `close` message that is used whenever the “Close” word is encountered is not a good approach since it can potentially cause issues due to lack of context.
*   Use [variable interpolation](https://www.i18next.com/translation-function/interpolation) whenever appropriate.
    *   If you see multiple messages joined together only to apply add a variable such as a user-inputted value, try to join those messages together into a single message containing a variable.
    *   So instead of `“Number of updates: “ + numUpdates + “.”` use `$(t("number_updates", { numUpdates }))` where the message translation would appear as `Number of updates: {{numUpdates}}.`