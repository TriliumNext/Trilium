# Link Previews
Link previews turn a pasted URL into a rich, metadata-aware widget that can be displayed in three visual modes:

## Display modes

A link preview can be displayed in one of three modes:

*   **Inline** — a link showing the site's favicon and page title (quite similar to <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a>). Use this when you want the link to flow with the surrounding paragraph.
*   **Card** — a block-level preview with thumbnail, title, description, and site name. Use this when the link is the focus of a paragraph.
*   **Embed** — a block-level interactive embed.
    *   Currently supported for YouTube videos, which render interactively (via an `iframe`).
    *   To prevent unwanted remote requests, the video is shown only after clicking on it first.

<table class="ck-table-resized">
    <colgroup>
        <col style="width:21.85%;">
        <col style="width:38.84%;">
        <col style="width:39.31%;">
    </colgroup>
    <tbody>
        <tr>
            <td><figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:251/42;" src="Link Previews_image.png" width="251" height="42"><figcaption><em>Inline</em> link preview</figcaption></figure></td>
            <td><figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:1217/196;" src="2_Link Previews_image.png" width="1217" height="196"><figcaption><em>Card</em> link preview</figcaption></figure></td>
            <td><figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:994/563;" src="1_Link Previews_image.png" width="994" height="563"><figcaption><em>Embed</em> link preview</figcaption></figure></td>
        </tr>
    </tbody>
</table>

## Inserting a link preview

There are two ways to create one:

### 1\. By pasting a URL

A link preview is automatically created:

*   By pasting the URL and pressing <kbd>Space</kbd>. This will create an _inline_ link preview.
*   When at the start of a new paragraph, pressing <kbd>Enter</kbd> will create a _card_ or an _embed_ for YouTube URLs.

To undo an automatic link preview, press <kbd>Ctrl</kbd>+<kbd>Z</kbd> immediately afterwards which keeps it as a plain link instead. Alternatively, once a link preview was created, click on the link and select _Plain link_ from the link preview toolbar.

This automatic conversion can be disabled by going to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and unchecking _Autogenerate link previews_ from the _Features_ section.

If the link is not accessible to the Trilium server (or the network request fails for any other reason), it will not be converted to a link preview.

> [!NOTE]
> A URL is only auto-converted when the pasted text _is_ the URL. Links with a display name (e.g. [Trilium Notes website](https://triliumnotes.org)) are left as plain links.

### 2\. By using the "Link preview" toolbar button

Click **Link preview** in the formatting toolbar to open the _Link preview_ popup. Paste the URL and choose the type of preview.

## Altering an existing link preview

Click on an inserted link preview to select it, and a small toolbar will appear with the following options:

*   The normal link operations (opening in a new tab, copying the link, unlinking).
*   A button to edit the title of the link preview. This is especially useful if the title is hidden behind a login screen.
*   A way to switch between the link preview modes (Inline, Card or Embed) as well as to convert it to a normal link instead.
    *   The Embed option is only enabled when the URL points to a supported service (YouTube today).

## Where the preview data comes from

When you insert a link preview, Trilium fetches metadata once and stores it inside the note's HTML:

*   **YouTube URLs** — title, channel name, and thumbnail are fetched via YouTube's public oEmbed endpoint.
*   **All other URLs** — Trilium fetches the page and reads OpenGraph tags (`og:title`, `og:description`, `og:image`, `og:site_name`), falling back to the page's `<title>` and `<meta name="description">`. The site's favicon is downloaded and inlined.

Because the data is stored in the note itself, link previews continue to render correctly when you reopen the note, share/publish it, or export to HTML — without any further network requests.

The metadata is captured **at insertion time** and is not automatically refreshed. If the linked page later changes its title or thumbnail, you'll need to re-insert the link to pick up the new values. To refresh a link, simply create it again.

When accessing a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a>, the data is fetched from the remote URL by the server and not the client.

## Known limitations

*   The Embed display mode currently only supports YouTube. Other video and media platforms fall back to a Card preview.
*   Pages that block automated fetches may produce a minimal preview (hostname only).
*   Link previews require the Trilium server to reach the target URL, so they won't generate previews for pages on networks the server can't see.