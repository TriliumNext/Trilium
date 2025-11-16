# Documentation references in the application
## Hard-coded links

Hard-coded links are present throughout the application, either in dialogs or in the source code as comments.

You can identify these links by searching for:

```
https://triliumnext.github.io/Docs/Wiki/
```

## Help buttons

There is a pattern of “?” buttons throughout the application which make use of the `data-help-page` attribute. Whenever these buttons are pressed, the user is redirected to the corresponding wiki page by prepending the wiki root URL to the `data-help-page` attribute.

### Deprecated `help-page` attribute

Since the current wiki has a different structure than the original, for example to link to [https://github.com/TriliumNext/Docs/blob/main/Wiki/tree-concepts.md](https://github.com/TriliumNext/Docs/blob/main/Wiki/tree-concepts.md) the `data-help-page` attribute must be set to `tree-concepts.md`.

For links to headings, simply add the heading after the `.md`: `tree-concepts.md#prefix`

You can identify those by looking for:

*   `.attr("data-help-page"`
*   `data-help-page="`

### More modern `data-in-app-help` attribute

Instead of opening in a web browser, this opens the help directly in the application in a split view. This is handled via the `data-in-app-help` attribute, where the value is the note ID of the help page without the `_help_` prefix.

### React

Use the `HelpButton` component in the same fashion as the `data-in-app-help` attribute.