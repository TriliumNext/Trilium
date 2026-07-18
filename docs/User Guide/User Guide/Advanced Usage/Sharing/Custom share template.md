# Custom share template
> [!NOTE]
> This topic of creating share templates is considered advanced and requires JavaScript/EJS knowledge.
> 
> The default share template should cover most normal uses.

For full control over the HTML structure of a shared page — beyond what custom CSS, JS, or HTML snippets allow — you can replace the page template entirely using the `~shareTemplate` relation.

To do so:

1.  Create a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note with the language _Embedded JavaScript_ (EJS).
2.  For a shared note to apply the newly created template, apply the `~shareTemplate` relation pointing to the note created at step (1). Make use of <a class="reference-link" href="../Attributes/Attribute%20Inheritance.md">Attribute Inheritance</a> to apply it to multiple shared notes.

There are two important constraints to be aware of:

*   Because EJS templates execute arbitrary server-side JavaScript, `~shareTemplate` only takes effect when backend scripting is enabled. If it is disabled (see <a class="reference-link" href="../../Scripting/Security.md">Security</a>), the relation is ignored and the default template is used. For the same reason, **only apply templates from notes you trust**.
*   The template note must be part of the shared subtree (just like `~shareCss`, `~shareJs`) in order for it to be loaded. To prevent it from being shown in the navigation, apply `#shareHiddenFromTree` to it.

## Content of the share template

Use the [original template](https://github.com/TriliumNext/Notes/blob/develop/packages/share-theme/src/templates/page.ejs) as reference when creating a new share template.

## Available variables

Your template is rendered with a context object exposing the note and its rendering environment. The most useful values are:

| Variable | Description |
| --- | --- |
| `note` | The note being rendered. Use it to read attributes (`note.getLabelValue(...)`), `note.title`, child notes, etc. |
| `content` | The note's already-rendered HTML content, as a string. |
| `header` | Extra HTML to place in the document head for this note (used by some note types). |
| `isEmpty` | `true` when the note has no content of its own. |
| `subRoot` | The root of the shared subtree as `{ note, branch }` — handy for a site-wide title or logo. |
| `cssToLoad` / `jsToLoad` | Arrays of stylesheet / script URLs the default theme would inject (includes anything added via `~shareCss` / `~shareJs`). |
| `faviconUrl` / `logoUrl` | Resolved favicon and logo URLs. |
| `isStatic` | `true` during a static HTML export, `false` for a live server render. |
| `t` | The `i18next` translation function. |
| `utils` | Helper utilities such as `slugify()` and `stripTags()`. |

## Error handling

If your template throws an error while rendering, Trilium logs the error and quietly falls back to the default template, so a broken template never takes the shared page down.

## Splitting a template into partials

A template can pull in other EJS notes as partials. Create them as **child notes** of the template note (each also a `code` / `application/x-ejs` note) and reference them by title:

```
<%- include("header") %>

<main>
    <h1><%= note.title %></h1>
    <%- content %>
</main>

<%- include("footer") %>

```

Here `header` and `footer` are the titles of child notes of the template. Only direct children are resolvable, and they must be EJS code notes.