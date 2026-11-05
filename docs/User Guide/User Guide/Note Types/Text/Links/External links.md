# External links
An external link is a standard web link targeting for example a website. For example, [https://en.wikipedia.org/wiki/South\_China\_Sea](https://en.wikipedia.org/wiki/South_China_Sea) is an external link to a Wikipedia page.

To create a link without a custom text:

*   Press <span class="tn-icon cke cke-link"></span> in the <a class="reference-link" href="../Formatting%20toolbar.md">Formatting toolbar</a>, or press <kbd>Ctrl</kbd>+<kbd>K</kbd>:
    *   Since v0.107.0, the _Add link_ dialog opens on _Web page_, in a popup next to the cursor on desktop. Type or paste the address, and optionally a _Link title_; without one, the link shows its address. The <span class="tn-icon bx bx-paste"></span> _Paste_ button at the end of the address field replaces its text with the text on the clipboard. This button is shown only where Trilium can read the clipboard: in the desktop app, and in a browser over HTTPS unless access to the clipboard was blocked.
    *   When you leave the address field, or paste with the _Paste_ button, an empty _Link title_ is filled with the title of the web page; a spinner at its end shows while it loads. A title you type is kept. To turn this off, go to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Text Notes_ and turn off _Automatically retrieve titles for text links_ in the _Features_ section.
    *   _Display as_ inserts the address as _Text_, or as one of the <a class="reference-link" href="../Link%20Previews.md">Link Previews</a>: _Icon & text_, _Card_ or, for a YouTube video or the address of an audio or video file, _Embed_.
    *   Press <kbd>Enter</kbd> or _Insert link_ to confirm.
*   Alternatively, use <a class="reference-link" href="../Slash%20Commands.md">Slash Commands</a> and choose _Link to a web page_, which opens the same dialog. _Link to a web page (with icon)_ and _Link to a web page (as a card)_ open it with that display already picked.
*   A simpler way is to paste the raw link and press space to turn it automatically into a link.
*   The <span class="tn-icon cke cke-trilium"></span> button and <kbd>Ctrl</kbd>+<kbd>L</kbd> of <a class="reference-link" href="Internal%20(reference)%20links.md">Internal (reference) links</a> open the same dialog on _Note_. Select _Web page_ at the top of the dialog to create an external link from there.

An address without a scheme, such as `example.com`, gets `https://`. The dialog does not insert an address that is not a valid URL, or a `javascript:`, `vbscript:` or `data:` link, since those can run code, and shows the reason under the address field. A URL pasted into the _Note_ field, or picked from its search, switches the dialog to _Web page_. The dialog also opens on _Web page_ when the selected text is a URL.

To create a link with a custom text:

*   First, type and select the text which will be turned into a link.
*   Open the _Add link_ dialog as above (via the formatting toolbar, or <kbd>Ctrl</kbd>+<kbd>K</kbd>). The selected text becomes the text of the link, so the dialog does not offer _Display as_.
*   Alternatively, simply paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>) over the selected text to turn it into a link.

Once a link is inserted:

*   The text inside the link can be changed if needed but the link itself will remain.
*   To modify the link, click on the link to display the popup and press the <span class="tn-icon cke cke-pencil"></span> _Edit link_ button. It opens the _Edit link_ dialog, filled with the link's address and text, as do placing the cursor inside the link and pressing <kbd>Ctrl</kbd>+<kbd>K</kbd>, <kbd>Ctrl</kbd>+<kbd>L</kbd> or one of the link buttons. _Save link_ changes the whole link, its text included, and the dialog can also turn it into a link to a note.
*   To remove a link, click on it, open the <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ menu at the end of the popup and choose <span class="tn-icon cke cke-unlink"></span> _Unlink_. The text stays, without the link.
*   The same menu has _Open link_, _Edit link_ and _Copy address (URL)_, and _Display as_, which turns the link into one of the <a class="reference-link" href="../Link%20Previews.md">Link Previews</a>, as does the _Display_ menu of the popup.
*   Right-clicking a link opens the same menu.

To follow an external link, double-click it, which opens it in a new tab or window, or right-click it in a note being edited and choose _Open link_.