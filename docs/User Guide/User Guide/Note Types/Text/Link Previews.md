# Link Previews
Link previews turn a pasted URL into a rich, metadata-aware widget that can be displayed in three visual modes:

## Link display modes

A link preview can be displayed in one of three link display modes:

*   **Icon & text** — a link showing the site's favicon and page title (quite similar to <a class="reference-link" href="Links/Internal%20(reference)%20links.md">Internal (reference) links</a>). Use this when you want the link to flow with the surrounding paragraph.
*   **Card** — a block-level preview with thumbnail, title, description, and site name. Use this when the link is the focus of a paragraph.
*   **Embed** — a block-level player.
    *   Supported for YouTube videos, which play in the YouTube player, and for audio and video files at a web address, which play in the media player of Trilium.
    *   To prevent unwanted remote requests, nothing is loaded from the site until you click play. Until then, a video shows its thumbnail with a play button, and an audio file its controls.
    *   The player can be resized and aligned (see _Audio and video_ below).

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
*   When at the start of a new paragraph, pressing <kbd>Enter</kbd> will create a _card_, or an _embed_ for a YouTube video or an audio or video file.

To undo an automatic link preview, press <kbd>Ctrl</kbd>+<kbd>Z</kbd> immediately afterwards which keeps it as a text link instead. Alternatively, once a link preview was created, click on the link and select _Text_ from the link preview toolbar, which makes a link that reads as the title of the page.

This automatic conversion can be disabled by going to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and unchecking _Autogenerate link previews_ from the _Features_ section.

If the link is not accessible to the Trilium server (or the network request fails for any other reason), it will not be converted to a link preview. The address of an audio or video file whose name ends in a known extension, such as `.mp4`, `.webm`, `.mp3` or `.flac`, becomes an _embed_ all the same.

> [!NOTE]
> A URL is only auto-converted when the pasted text _is_ the URL. Links with a display name (e.g. [Trilium Notes website](https://triliumnotes.org)) are left as text links.

### 2\. From the link dialog

Since v0.107.0, a link preview is created from the same _Add link_ dialog as any other link (see <a class="reference-link" href="Links/External%20links.md">External links</a>):

*   Press <span class="tn-icon cke cke-link"></span> in the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, or press <kbd>Ctrl</kbd>+<kbd>K</kbd>, to open the dialog on _Web page_.
*   Type or paste the address, then pick the preview in _Display as_: _Icon & text_, _Card_ or, for a YouTube video or the address of an audio or video file, _Embed_. _Text_ inserts an ordinary link. _Display as_ is not shown when text is selected, since the link then keeps the selected text.
*   Optionally, type a _Link title_ to show instead of the page's own title. A _Card_ also offers a _Description_ to show instead of the page's own description.
*   When you leave the address field, or paste the address with the <span class="tn-icon bx bx-paste"></span> _Paste_ button, Trilium reads the page and fills an empty _Link title_, and the empty _Description_ of a card, with the page's own. A spinner at the end of a field shows that its value is loading; once you type in the field, what you type is kept. Switching _Display as_ to _Card_ fills the _Description_ the same way, without reading the page again.
*   Press <kbd>Enter</kbd> or _Insert link_ to confirm. The link appears right away and turns into the preview once Trilium has read the page.

To keep the dialog from reading the page, go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and, in the _Features_ section, turn off _Automatically retrieve titles for text links_ (for _Text_) or _Automatically retrieve title and description for icon & text links and cards_ (for _Icon & text_ and _Card_). Both are on by default. While they are on, Trilium contacts the page as soon as you leave the address field, also for a text link. Inserting an _Icon & text_ link or a _Card_ reads the page either way, since the preview is built from it.

Alternatively, use <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a> and choose _Link to a web page (with icon)_ or _Link to a web page (as a card)_ (both are also found by _link preview_). Each opens the same dialog on _Web page_, with _Icon & text_ or _Card_ already picked.

To turn an existing link into a preview, open its _Edit link_ dialog and change _Display as_, or pick a display in the _Display_ menu of the link's toolbar. Either way, a link whose text differs from its address keeps that text as the title of the preview.

### 3\. From the Insert menu, for audio and video

Choose <span class="tn-icon bx bx-movie-play"></span> _Audio/video embed_ from the <a class="reference-link" href="Insert%20buttons.md">Insert buttons</a> menu or the <a class="reference-link" href="Slash%20Commands.md">Slash Commands</a>. Paste the address of a YouTube video, or of an audio or video file, and press _Insert media_ or <kbd>Enter</kbd> to insert it as an _Embed_. The <span class="tn-icon bx bx-paste"></span> _Paste_ button at the end of the field replaces its text with the text on the clipboard. This button is shown only where Trilium can read the clipboard: in the desktop app, and in a browser over HTTPS unless access to the clipboard was blocked.

The media is inserted once Trilium has read the address, which can take a few seconds: the title and thumbnail of a YouTube video, or whether a file is audio or video. When the address cannot be read, or is that of a web page rather than of a YouTube video or a media file, an error is shown and the prompt stays open. Opening another note in the meantime cancels the insertion.

### 4\. By saving browser tabs from the Web Clipper

When the <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a> saves the tabs of a window, each tab becomes an _Icon & text_ link preview showing the title and favicon the browser displays for it. Because this data comes from the browser, pages behind a login keep their real title, and the Trilium server does not contact the saved pages.

When _Autogenerate link previews_ is turned off, the tabs are saved as a list of text links instead.

## Altering an existing link preview

Click on an inserted _Icon & text_ or _Card_ link preview to select it, and a small toolbar will appear with the following options:

*   _Open link_, which opens the page in a new tab, and <span class="tn-icon cke cke-trilium-copy"></span> _Copy address (URL)_.
*   The <span class="tn-icon cke cke-pencil"></span> _Edit link_ button, which opens the _Edit link_ dialog on the link preview, as does pressing <kbd>Ctrl</kbd>+<kbd>K</kbd> while it is selected. The dialog changes its address, its _Link title_ (especially useful if the title is hidden behind a login screen), the _Description_ of a card and how it is displayed. A new address shows the title and description of the new page, unless you type your own.
*   The _Display_ menu, which converts the preview to a normal link that reads as its title (_Text_) or switches it to another display mode (_Icon & text_, _Card_ or _Embed_).
    *   The Embed option is only shown for a YouTube video or an audio or video file. A _Card_ of a file whose address does not end in a known extension, such as `.mp4` or `.mp3`, no longer offers it.
*   The <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu, with <span class="tn-icon cke cke-web"></span> _Open link_, <span class="tn-icon cke cke-pencil"></span> _Edit link_, <span class="tn-icon cke cke-trilium-copy"></span> _Copy address (URL)_, the same display modes under <span class="tn-icon cke cke-trilium-link-preview"></span> _Display as_, and <span class="tn-icon cke cke-unlink"></span> _Unlink_, which replaces the preview with its address as plain text.

Right-clicking a link preview selects it and opens its _More actions_ menu.

### Audio and video

A YouTube video, a video file or an audio file shown as an _Embed_ has a size, a position, a title and a caption, like an <a class="reference-link" href="Include%20Note.md">Include Note</a>. A video keeps its shape, so a YouTube Short stands upright and an older video can be 4:3. A YouTube video inserted in an earlier version is 16:9 until it is inserted again. In the editor, a click on the video both plays it and selects it, and so does a later click on the player.

A video file or an audio file plays in the media player of Trilium, the one of <a class="reference-link" href="../File.md">File</a> notes, with its play button, seek bar and volume. A video file shows a picture of one of its frames, taken when it is inserted (see _Where the preview data comes from_ below), and a <span class="tn-icon bx bx-movie"></span> icon when it has none. An audio file shows a row of controls. When a file cannot be played, a message takes the place of the player, at the size of the video. Under it is the error that the site answered, if any, such as _HTTP 404: Not found_ for a file that is no longer there.

The toolbar of a selected embed offers:

*   <span class="tn-icon cke cke-trilium-copy"></span> _Copy address (URL)_.
*   The _Display_ menu, which turns the embed into an _Icon & text_ or _Card_ link preview with its title, or a _Text_ link that reads as its title. The text of its caption stays, as a paragraph after it.
*   The <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu:
    *   <span class="tn-icon bx bx-link-external"></span> _Open externally_ opens the media outside Trilium: in the browser, or in the app that handles the link, such as the YouTube app on Android.
    *   <span class="tn-icon cke cke-pencil"></span> _Edit..._ opens the _Edit link_ dialog with only the _Address (URL)_ and the _Link title_ of the media, as does pressing <kbd>Ctrl</kbd>+<kbd>K</kbd> while the embed is selected. With another address, the embed plays the new media and keeps its size, position, title and caption. It takes the thumbnail and the shape of the new media, and a video file gets a picture of one of its frames, as when it is inserted. A video at its first size takes the first size of the new video, and an audio file in place of a video, or a video in place of an audio file, takes the size of new media. A new address shows the title of the new media, unless you type your own. When the address is not that of a YouTube video, an audio or a video file, the embed stays as it was and Trilium shows an error.
    *   <span class="tn-icon cke cke-trilium-copy"></span> _Copy address (URL)_.
    *   The display modes of the _Display_ menu under <span class="tn-icon cke cke-trilium-link-preview"></span> _Display as_.
    *   _Size_: a _Resizable_ video can be resized and placed in the text, a _Full_ video takes the width of the note, or less when it would be taller than most of the window, and a _Compact_ video is a row with its title alone. A new video is _Resizable_. A YouTube video inserted in an earlier version is _Full_. An audio file is _Compact_, a row of controls, or _Resizable_, a box with the controls under the visualizer, whose width can be resized. _Default_, after the sizes, returns the media to the size it was inserted at.
    *   _Position_: under _Break text_, <span class="tn-icon cke cke-object-left"></span> _Align left_, <span class="tn-icon cke cke-object-center"></span> _Align center_ and <span class="tn-icon cke cke-object-right"></span> _Align right_ place the video on lines of its own, at that side of the note. Under _Wrap text_, <span class="tn-icon cke cke-object-inline-left"></span> _Align left_ and <span class="tn-icon cke cke-object-inline-right"></span> _Align right_ place it at that side and let the text run beside it. _Align center_ is the default. Only a _Resizable_ video or audio file can be positioned.
    *   _Show title_ shows the title of the media above it, as a link to the media. New media is inserted without its title. The <span class="tn-icon bx bx-dots-vertical-rounded"></span> button of the title opens this same menu.
    *   _Show caption_ adds a caption under the video, centered, and puts the cursor in it. The caption is part of the text note, so it can be formatted like the rest of the text. While the cursor is in the caption, the video stays selected and keeps its toolbar. Choosing _Show caption_ again removes the caption.
    *   <span class="tn-icon bx bx-trash"></span> _Delete block_ removes the video from the note.

Right-clicking a video file or an audio file opens the same _More actions_ menu. So does right-clicking a YouTube video, but only until it plays: from then on, the right-click goes to YouTube's player, which shows its own menu.

To resize a _Resizable_ video or audio file, select it and drag the handle in its bottom-right corner, or its bottom-left corner for one aligned to the right. The height of a video follows the width. _Default_ in the _Size_ submenu returns a video to its first size.

On a [shared page](../../Advanced%20Usage/Sharing.md), the media keeps its width, position and caption, but not its title. A video or audio file plays in the browser's own player once the visitor clicks it. In the mobile layout, media with a position other than _Align center_ takes the full width.

## Where the preview data comes from

When you insert a link preview, Trilium fetches metadata once and stores it with the note:

*   **YouTube URLs**: the title, the channel name and the shape of the video are fetched via YouTube's public oEmbed endpoint, and the video's thumbnail is downloaded at up to 1280×720.
*   **Audio and video files**: Trilium reads the start of the file, enough to tell audio from video and, for most MP4 and WebM files, the shape of the video. The rest of the file is not downloaded, and the file is not copied into Trilium. Once a video file is inserted, the editor takes a picture of a frame a few seconds into it as its thumbnail. The frame is read through the Trilium server, so the site of the file sees the server and not your browser. The standalone (browser) and mobile versions have no such server: they read the frame from the site directly, and a video whose site does not let other sites read it has no thumbnail.
*   **All other URLs**: Trilium fetches the page and reads OpenGraph tags (`og:title`, `og:description`, `og:image`, `og:site_name`), falling back to the page's `<title>` and `<meta name="description">`. The site's favicon and the page's image are downloaded as well.

The text is kept in the note's HTML. The images are kept as system <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a> of the note, listed under _Generated by Trilium_.

Because the data is stored in the note itself, link previews continue to render correctly when you reopen the note, share/publish it, or export to HTML — without any further network requests.

The metadata is captured **at insertion time** and is not automatically refreshed. If the linked page later changes its title or thumbnail, you'll need to re-insert the link to pick up the new values. To refresh a link, simply create it again.

A YouTube embed inserted before v0.107.0 keeps its smaller thumbnail, shown blurred, until the link is inserted again.

When accessing a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a>, the data is fetched from the remote URL by the server and not the client.

## Known limitations

*   The Embed display mode supports YouTube and audio and video files. Pages of other video and media platforms fall back to a Card preview.
*   An audio or video file plays from its address: it needs that address to be reachable, and stops playing when the file is moved or deleted. It plays only in a format that the browser, or the desktop app, supports.
*   A file served over plain `http://` might not play in the desktop app or from a Trilium server reached over `https://`.
*   An audio file shows no visualizer and no waveform, unlike an audio <a class="reference-link" href="../File.md">File</a> note, since the site of the file does not generally let Trilium read its sound.
*   Pages that block automated fetches may produce a minimal preview (hostname only).
*   Link previews require the Trilium server to reach the target URL, so they won't generate previews for pages on networks the server can't see.