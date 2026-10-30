# Link Previews
Link previews turn a pasted URL into a rich, metadata-aware widget that can be displayed in three visual modes:

## Display modes

A link preview can be displayed in one of three modes:

*   **Inline** — a link showing the site's favicon and page title (quite similar to <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a>). Use this when you want the link to flow with the surrounding paragraph.
*   **Card** — a block-level preview with thumbnail, title, description, and site name. Use this when the link is the focus of a paragraph.
*   **Embed** — a block-level interactive embed.
    *   Currently supported for YouTube videos, which render interactively (via an `iframe`).
    *   To prevent unwanted remote requests, the video is shown only after clicking on it first. Until then, the video's thumbnail is shown with a play button.

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1-1">
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:251/42;" src="Link Previews_image.png" width="251" height="42"><figcaption><em>Inline</em> link preview</figcaption></figure>

</div>
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:1217/196;" src="2_Link Previews_image.png" width="1217" height="196"><figcaption><em>Card</em> link preview</figcaption></figure>

</div>
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:994/563;" src="1_Link Previews_image.png" width="994" height="563"><figcaption><em>Embed</em> link preview</figcaption></figure>

</div>
</div>

## Inserting a link preview

There are three ways to create one:

### 1\. By pasting a URL

A link preview is automatically created:

*   By pasting the URL and pressing <kbd>Space</kbd>. This will create an _inline_ link preview.
*   When at the start of a new paragraph, pressing <kbd>Enter</kbd> will create a _card_ or an _embed_ for YouTube URLs.

To undo an automatic link preview, press <kbd>Ctrl</kbd>+<kbd>Z</kbd> immediately afterwards which keeps it as a plain link instead. Alternatively, once a link preview was created, click on the link and select _Plain link_ from the link preview toolbar.

This automatic conversion can be disabled by going to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and unchecking _Autogenerate link previews_ from the _Features_ section.

If the link is not accessible to the Trilium server (or the network request fails for any other reason), it will not be converted to a link preview.

> [!NOTE]
> A URL is only auto-converted when the pasted text _is_ the URL. Links with a display name (e.g. [Trilium Notes website](https://triliumnotes.org)) are left as plain links.

### 2\. From the link dialog

Since v0.107.0, a link preview is created from the same _Add link_ dialog as any other link (see <a class="reference-link" href="Links/External%20links.md">External links</a>):

*   Press <span class="tn-icon cke cke-link"></span> in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, or press <kbd>Ctrl</kbd>+<kbd>K</kbd>, to open the dialog on _Web link_.
*   Type or paste the address, then pick the preview in _Display as_: _Inline_, _Card_ or, for a YouTube video, _YouTube embed_. _Plain link_ inserts an ordinary link. _Display as_ is not shown when text is selected, since the link then keeps the selected text.
*   Optionally, type a _Link title_ to show instead of the page's own title. A _Card_ also offers a _Description_ to show instead of the page's own description.
*   Press <kbd>Enter</kbd> or _Add link_ to confirm. The link appears right away and turns into the preview once Trilium has read the page.

Alternatively, use <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a> and look for _link preview_ (it is also found by _embed_, _url_ or _video_). It opens the same dialog with a preview already picked: a _YouTube embed_ for a YouTube video, a _Card_ for any other page.

To turn an existing link into a preview, open its _Edit link_ dialog and change _Display as_. A link whose text differs from its address keeps that text as the title of the preview.

### 3\. By saving browser tabs from the Web Clipper

When the <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a> saves the tabs of a window, each tab becomes an _inline_ link preview showing the title and favicon the browser displays for it. Because this data comes from the browser, pages behind a login keep their real title, and the Trilium server does not contact the saved pages.

When _Autogenerate link previews_ is turned off, the tabs are saved as a list of plain links instead.

## Altering an existing link preview

Click on an inserted link preview to select it, and a small toolbar will appear with the following options:

*   The normal link operations (opening in a new tab, copying the link, unlinking).
*   The <span class="tn-icon cke cke-pencil"></span> _Edit link_ button, which opens the _Edit link_ dialog on the link preview, as does pressing <kbd>Ctrl</kbd>+<kbd>K</kbd> while it is selected. The dialog changes its address, its _Link title_ (especially useful if the title is hidden behind a login screen), the _Description_ of a card and how it is displayed. A new address shows the title and description of the new page, unless you type your own.
*   A way to switch between the link preview modes (Inline, Card or Embed) as well as to convert it to a normal link instead.
    *   The Embed option is only enabled when the URL points to a supported service (YouTube today).

## Where the preview data comes from

When you insert a link preview, Trilium fetches metadata once and stores it with the note:

*   **YouTube URLs**: the title and channel name are fetched via YouTube's public oEmbed endpoint, and the video's thumbnail is downloaded at up to 1280×720.
*   **All other URLs**: Trilium fetches the page and reads OpenGraph tags (`og:title`, `og:description`, `og:image`, `og:site_name`), falling back to the page's `<title>` and `<meta name="description">`. The site's favicon and the page's image are downloaded as well.

The text is kept in the note's HTML. The images are kept as system <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a> of the note, listed under _Generated by Trilium_.

Because the data is stored in the note itself, link previews continue to render correctly when you reopen the note, share/publish it, or export to HTML — without any further network requests.

The metadata is captured **at insertion time** and is not automatically refreshed. If the linked page later changes its title or thumbnail, you'll need to re-insert the link to pick up the new values. To refresh a link, simply create it again.

A YouTube embed inserted before v0.107.0 keeps its smaller thumbnail, shown blurred, until the link is inserted again.

When accessing a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a>, the data is fetched from the remote URL by the server and not the client.

## Known limitations

*   The Embed display mode currently only supports YouTube. Other video and media platforms fall back to a Card preview.
*   Pages that block automated fetches may produce a minimal preview (hostname only).
*   Link previews require the Trilium server to reach the target URL, so they won't generate previews for pages on networks the server can't see.