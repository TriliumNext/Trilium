# Link Previews
Link previews turn a pasted URL into a rich, metadata-aware widget that can be displayed in three visual modes:

## Display modes

A link preview can be displayed in one of three modes:

*   <img class="image_resized" style="aspect-ratio:251/42;width:25%;" src="Link Previews_image.png" width="251" height="42">**Inline** — a pill showing the site's favicon and page title. Use this when you want the link to flow with the surrounding paragraph.
*   <img class="image_resized" style="aspect-ratio:1217/196;width:61.28%;" src="2_Link Previews_image.png" width="1217" height="196">
    
    **Card** — a block-level preview with thumbnail, title, description, and site name. Use this when the link is the focus of a paragraph.
*   <img class="image_resized" style="aspect-ratio:994/563;width:49.28%;" src="1_Link Previews_image.png" width="994" height="563">
    
    **Embed** — a block-level interactive embed. Currently supported for YouTube videos, which render as a playable iframe. For URLs that don't support an embedded view, this mode falls back to the Card layout.

## Inserting a link preview

There are two ways to create one:

### 1\. Paste a URL

Paste a raw URL and press <kbd>Space</kbd>. Trilium will fetch the page's metadata in the background and convert the link into a **Mention**. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> immediately afterwards to keep it as a plain link instead.

> [!NOTE]
> A URL is only auto-converted when the pasted text _is_ the URL. Links with a display name (e.g. [Trilium Notes website](https://triliumnotes.org)) are left as plain links.

### 2\. Use the "Link preview" toolbar button

Click **Link preview** in the formatting toolbar to open the _Insert link preview_ dialog. Enter the URL and choose **@ Mention**, **URL** (plain link, no preview), or **Embed**.

## Switching modes on an existing link preview

Click on an inserted link preview to select it. A small toolbar will offer the three modes — Inline, Card, and Embed. The Embed option is only enabled when the URL points to a supported service (YouTube today).

## Where the preview data comes from

When you insert a link preview, Trilium fetches metadata once and stores it inside the note's HTML:

*   **YouTube URLs** — title, channel name, and thumbnail are fetched via YouTube's public oEmbed endpoint.
*   **All other URLs** — Trilium fetches the page and reads OpenGraph tags (`og:title`, `og:description`, `og:image`, `og:site_name`), falling back to the page's `<title>` and `<meta name="description">`. The site's favicon is downloaded and inlined.

Because the data is stored in the note itself, link previews continue to render correctly when you reopen the note, share/publish it, or export to HTML — without any further network requests.

The metadata is captured **at insertion time** and is not automatically refreshed. If the linked page later changes its title or thumbnail, you'll need to re-insert the link to pick up the new values.

## Limitations

*   The Embed display mode currently only supports YouTube. Other video and media platforms fall back to a Card preview.
*   The preview reflects the page at the moment you inserted the link.
*   Pages that block automated fetches or that don't expose OpenGraph metadata may produce a minimal preview (hostname only).
*   Link previews require the Trilium server to reach the target URL, so they won't generate previews for pages on networks the server can't see.