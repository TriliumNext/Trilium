# Link Previews
Link previews turn a pasted URL into a rich, metadata-aware widget that can be displayed in three visual modes:

## Link display modes

A link preview can be displayed in one of three link display modes:

*   **Icon & text** — a link showing the site's favicon and page title (quite similar to <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a>). Use this when you want the link to flow with the surrounding paragraph.
*   **Card** — a block-level preview with thumbnail, title, description, and site name. Use this when the link is the focus of a paragraph.
*   **Embed** — a block-level interactive embed.
    *   Currently supported for YouTube videos, which render interactively (via an `iframe`).
    *   To prevent unwanted remote requests, the video is shown only after clicking on it first. Until then, the video's thumbnail is shown with a play button.
    *   The video can be resized and aligned (see _Videos_ below).

A fourth link display mode, **Text**, inserts an ordinary link without a preview.

> [!NOTE]
> Since v0.107.0, _Display as_ and the _Display_ menu show _Text_ instead of _Plain link_, and _Icon & text_ instead of _Inline_.

<div class="trilium-multicolumn-layout" data-trilium-column-ratios="1-1-1">
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:251/42;" src="Link Previews_image.png" width="251" height="42"><figcaption><em>Icon &amp; text</em> link preview</figcaption></figure>

</div>
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:1217/196;" src="2_Link Previews_image.png" width="1217" height="196"><figcaption><em>Card</em> link preview</figcaption></figure>

</div>
<div class="trilium-multicolumn-column">

<figure class="image image_resized" style="width:100%;"><img style="aspect-ratio:994/563;" src="1_Link Previews_image.png" width="994" height="563"><figcaption><em>Embed</em> link preview</figcaption></figure>

</div>
</div>

## Inserting a link preview

There are four ways to create one:

### 1\. By pasting a URL

A link preview is automatically created:

*   By pasting the URL and pressing <kbd>Space</kbd>. This will create an _Icon & text_ link preview.
*   When at the start of a new paragraph, pressing <kbd>Enter</kbd> will create a _card_ or an _embed_ for YouTube URLs.

To undo an automatic link preview, press <kbd>Ctrl</kbd>+<kbd>Z</kbd> immediately afterwards which keeps it as a text link instead. Alternatively, once a link preview was created, click on the link and select _Text_ from the link preview toolbar.

This automatic conversion can be disabled by going to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and unchecking _Autogenerate link previews_ from the _Features_ section.

If the link is not accessible to the Trilium server (or the network request fails for any other reason), it will not be converted to a link preview.

> [!NOTE]
> A URL is only auto-converted when the pasted text _is_ the URL. Links with a display name (e.g. [Trilium Notes website](https://triliumnotes.org)) are left as text links.

### 2\. From the link dialog

Since v0.107.0, a link preview is created from the same _Add link_ dialog as any other link (see <a class="reference-link" href="Links/External%20links.md">External links</a>):

*   Press <span class="tn-icon cke cke-link"></span> in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, or press <kbd>Ctrl</kbd>+<kbd>K</kbd>, to open the dialog on _Web link_.
*   Type or paste the address, then pick the preview in _Display as_: _Icon & text_, _Card_ or, for a YouTube video, _YouTube embed_. _Text_ inserts an ordinary link. _Display as_ is not shown when text is selected, since the link then keeps the selected text.
*   Optionally, type a _Link title_ to show instead of the page's own title. A _Card_ also offers a _Description_ to show instead of the page's own description.
*   When you leave the address field, or paste the address with the <span class="tn-icon bx bx-paste"></span> _Paste_ button, Trilium reads the page and fills an empty _Link title_, and the empty _Description_ of a card, with the page's own. A spinner at the end of a field shows that its value is loading; once you type in the field, what you type is kept. Switching _Display as_ to _Card_ fills the _Description_ the same way, without reading the page again.
*   Press <kbd>Enter</kbd> or _Insert link_ to confirm. The link appears right away and turns into the preview once Trilium has read the page.

To keep the dialog from reading the page, go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and, in the _Features_ section, turn off _Automatically retrieve titles for text links_ (for _Text_) or _Automatically retrieve title, description and icon for icon & text links and cards_ (for _Icon & text_ and _Card_). Both are on by default. While they are on, Trilium contacts the page as soon as you leave the address field, also for a text link.

Alternatively, use <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a> and choose _Link to a web page (with icon)_ or _Link to a web page (as a card)_ (both are also found by _link preview_). Each opens the same dialog on _Web link_, with _Icon & text_ or _Card_ already picked.

To turn an existing link into a preview, open its _Edit link_ dialog and change _Display as_. A link whose text differs from its address keeps that text as the title of the preview.

### 3\. From the Insert menu, for a YouTube video

Choose <span class="tn-icon bx bxl-youtube"></span> _YouTube video_ from the <a class="reference-link" href="Insert%20buttons.md">Insert buttons</a> menu, or _Insert YouTube video_ from the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>. Paste the address of the video and press _Insert video_ or <kbd>Enter</kbd> to insert it as an _Embed_. The <span class="tn-icon bx bx-paste"></span> _Paste_ button at the end of the field replaces its text with the text on the clipboard. This button is shown only where Trilium can read the clipboard: in the desktop app, and in a browser over HTTPS unless access to the clipboard was blocked. The video is inserted once its title and thumbnail have loaded, which can take a few seconds. When they cannot be loaded, an error is shown and the prompt stays open. Opening another note in the meantime cancels the insertion.

### 4\. By saving browser tabs from the Web Clipper

When the <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a> saves the tabs of a window, each tab becomes an _Icon & text_ link preview showing the title and favicon the browser displays for it. Because this data comes from the browser, pages behind a login keep their real title, and the Trilium server does not contact the saved pages.

When _Autogenerate link previews_ is turned off, the tabs are saved as a list of text links instead.

## Altering an existing link preview

Click on an inserted _Icon & text_ or _Card_ link preview to select it, and a small toolbar will appear with the following options:

*   The normal link operations (opening in a new tab, copying the link, unlinking).
*   The <span class="tn-icon cke cke-pencil"></span> _Edit link_ button, which opens the _Edit link_ dialog on the link preview, as does pressing <kbd>Ctrl</kbd>+<kbd>K</kbd> while it is selected. The dialog changes its address, its _Link title_ (especially useful if the title is hidden behind a login screen), the _Description_ of a card and how it is displayed. A new address shows the title and description of the new page, unless you type your own.
*   A way to switch between the link display modes (Icon & text, Card or Embed) as well as to convert it to a normal link (Text) instead.
    *   The Embed option is only enabled when the URL points to a supported service (YouTube today).

### Videos

A YouTube video shown as an _Embed_ has a size, a position, a title and a caption, like an <a class="reference-link" href="Include%20Note.md">Include Note</a>. It keeps the shape of the video, so a YouTube Short stands upright and an older video can be 4:3. A video inserted in an earlier version is 16:9 until it is inserted again. In the editor, a click on the video both plays it and selects it, and so does a later click on the player. The toolbar of a selected video offers:

*   <span class="tn-icon cke cke-trilium-copy"></span> _Copy URL_.
*   The _Display_ menu, which turns the video into an _Icon & text_ or _Card_ link preview, or a _Text_ link. The text of its caption stays, as a paragraph after it.
*   The <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu:
    *   <span class="tn-icon bx bx-link-external"></span> _Open externally_ opens the video outside Trilium: in the browser, or in the app that handles the link, such as the YouTube app on Android.
    *   _Size_: a _Medium_ video can be resized, a _Full_ video takes the width of the note, or less when it would be taller than most of the window. A new video is _Medium_. A video inserted in an earlier version is _Full_.
    *   _Position_: under _Break text_, <span class="tn-icon cke cke-object-left"></span> _Align left_, <span class="tn-icon cke cke-object-center"></span> _Align center_ and <span class="tn-icon cke cke-object-right"></span> _Align right_ place the video on lines of its own, at that side of the note. Under _Wrap text_, <span class="tn-icon cke cke-object-inline-left"></span> _Align left_ and <span class="tn-icon cke cke-object-inline-right"></span> _Align right_ place it at that side and let the text run beside it. _Align center_ is the default.
    *   _Show title_ shows the title of the video above it, as a link to the video. The <span class="tn-icon bx bx-dots-vertical-rounded"></span> button of the title opens this same menu.
    *   _Show caption_ adds a caption under the video, centered, and puts the cursor in it. The caption is part of the text note, so it can be formatted like the rest of the text. While the cursor is in the caption, the video stays selected and keeps its toolbar. Choosing _Show caption_ again removes the caption.
    *   <span class="tn-icon bx bx-trash"></span> _Delete_ removes the video from the note.

To resize a _Medium_ video, select it and drag the handle in its bottom-right corner, or its bottom-left corner for a video aligned to the right. The height follows the width. Choosing _Medium_ again returns the video to its first size.

On a [shared page](../../Advanced%20Usage/Sharing.md), the video keeps its width, position and caption, but not its title. In the mobile layout, a video with a position other than _Align center_ takes the full width.

## Where the preview data comes from

When you insert a link preview, Trilium fetches metadata once and stores it with the note:

*   **YouTube URLs**: the title, the channel name and the shape of the video are fetched via YouTube's public oEmbed endpoint, and the video's thumbnail is downloaded at up to 1280×720.
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