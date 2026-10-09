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
| `head` | The values of the page's `<head>`: `title` (the note's title, followed by the site's), `description` (`#shareDescription`), `noIndex` (`#shareDisallowRobotIndexing`) and `openGraph` with `url`, `domain`, `image`, `color` and `card` (`summary_large_image` with an image, `summary` without). A value whose label is not set is `null`. `metaTags` lists the description, OpenGraph and Twitter `<meta>` tags of the values that are set, each with `attribute` (`name` or `property`), `key` and `content`. |
| `logo` | The site logo above the navigation tree and, on a narrow screen, in the header: `href` (`#shareRootLink`, otherwise the site's root page), `image` (the `~shareLogo` image, or `null`), `icon` (the icon classes of the site's root note, shown when there is no `image`), and `width` and `height` for the image. |
| `navigation` | The navigation tree of the site: its visible pages, each with `title`, `href`, `isExternal`, `type`, `icon`, `isActive` (the page being shown), `isExpanded` (that page or one of its ancestors) and `children`. |
| `contentClasses` | The classes of the content element: `type-<note type>`, `ck-content` for text and Markdown notes, and `no-content` when the note has no content of its own. |
| `childLinks` | The links to the note's visible children, each with `title`, `href`, `isExternal`, `type`, `icon` (its icon classes), `excerpt` (its `#shareDescription` or the start of its text, or `null`) and `children` (when it has no excerpt, its first ten visible children, each with `title`, `href`, `isExternal` and `icon`). Empty for a note that is not a collection, a text note or a code note, and with `#hideChildrenOverview`. |
| `childLinksLayout` | How the default template lays `childLinks` out: `list` for a collection whose view type is list, `grid` otherwise. |
| `prevNext` | The pages before and after the note in the navigation tree, as `previous` and `next`, each with `title` and `href`, or `null`. |
| `language` | The languages of the page: `page` with the `lang` and `dir` of the application's language, and `content` with those of the note's content language, or `null` when they are the same. |
| `lastUpdated` | When the note was last changed, as `iso` for a `<time>` element and as `text` in the application's language, or `null`. |
| `snippets` | The HTML of the `~shareHtml` snippets for each location, such as `snippets["head:end"]`. Every location is present, empty when no snippet goes there. |
| `subRoot` | The root of the shared subtree as `{ note, branch }` — handy for a site-wide title or logo. |
| `cssToLoad` / `jsToLoad` | Arrays of stylesheet / script URLs the default theme would inject (includes anything added via `~shareCss` / `~shareJs`). |
| `faviconUrl` / `logoUrl` | Resolved favicon and logo URLs. Without `~shareLogo`, `logoUrl` is the Trilium logo. |
| `fontPreloads` | The icon fonts to preload, each with `href` and `type` (the font's media type): Boxicons, and the icon packs used by the logo, the navigation tree or the subpages. The default template adds a `<link rel="preload" as="font" crossorigin>` for each, so that the icons do not appear only after the first paint. |
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