# Web Clipper
![](Web%20Clipper_image.png)

Trilium Web Clipper is a web browser extension which allows user to clip text, screenshots, whole pages and short notes and save them directly to Trilium Notes.

## Supported browsers

Trilium Web Clipper officially supports the following web browsers:

*   Mozilla Firefox, using Manifest v2.
*   Google Chrome, using Manifest v3. Theoretically the extension should work on other Chromium-based browsers as well, but they are not officially supported.

## Obtaining the extension

The extension is available from the official browser web stores:

*   **Firefox**: [Trilium Web Clipper on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/trilium-notes-web-clipper/)
*   **Chrome**: [Trilium Web Clipper on Chrome Web Store](https://chromewebstore.google.com/detail/trilium-web-clipper/ofoiklieachadcaeffficgjaajojpkpi)

## Functionality

*   select text and clip it with the right-click context menu
*   click on an image or link and save it through context menu
*   save whole page from the popup or context menu
*   save screenshot (with crop tool) from either popup or context menu
*   create short text note from popup

## The popup

Clicking the extension's button in the browser toolbar opens its popup:

*   The popup shows what will be saved from the current page: the note's title, which can be edited before saving, the website, and below them a preview. A switch above the preview chooses what to save, among what the page offers:
    
    *   _Selection_, when text is selected on the page: _Save selection_ saves it into the note of that page's clippings, as the context menu does.
    *   _Page_, when the page has an article: _Save page to Trilium_ saves the article's text and images, and the publication date shows next to the website when the page states one.
    *   _Bookmark_, always: a text box for a note about the page replaces the preview, and _Save bookmark_ (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) saves a link to the page with that note. Left empty, the title stays the page's title.
    
    The popup opens on the selection if there is one, otherwise on the article. On a page with no article (Readability cannot find one) and no selection, it opens on _Bookmark_ and says the page has no article. The keyboard shortcuts and the context menu still save right away, without a preview.
*   Pages the extension cannot access (the browser's own pages, the extension stores, and pages that were open before the extension was installed until they are reloaded) cannot be saved or captured, so the popup says so in place of the preview, and only _Tabs_ remains available there.
*   Below the preview, a row of buttons offers the other actions: _Crop_ (a screenshot of an area you select), _Screenshot_ (of the visible part of the page) and _Tabs_ (saves the links of every tab in the current window as a list). Hovering over a button shows its full name and, if it has one, its keyboard shortcut.
*   If the current page was already clipped, a notice at the top offers to open the note in Trilium.
*   If Trilium cannot be found, the popup explains why instead of showing the actions, with buttons to look for Trilium again and to open the options.
*   The bottom of the popup shows whether the extension is connected to Trilium, as a colored dot (green when connected, amber when the versions are not compatible, red when Trilium was not found) next to a description of the connection, followed by the buttons for the extension's options and for this help page. A button to check the connection again appears next to them when hovering over the bar, and stays visible while Trilium cannot be reached or is not compatible.

## Location of clippings

Trilium will save these clippings as a new child note under a "clipper inbox" note.

By default, that's the <a class="reference-link" href="../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a> but you can override that by setting the [label](../Advanced%20Usage/Attributes.md) `clipperInbox`, on any other note.

If there's multiple clippings from the same page (and on the same day), then they will be added to the same note.

## Keyboard shortcuts

Keyboard shortcuts are available for most functions:

*   Save selected text: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (Mac: <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>S</kbd>)
*   Save whole page: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (Mac: <kbd>⌥</kbd>+<kbd>⇧</kbd>+<kbd>S</kbd>)
*   Save screenshot: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> (Mac: <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>E</kbd>)
*   Save all tabs of the current window: no default shortcut, but one can be assigned as described below.

To set custom shortcuts, follow the directions for your browser.

*   **Firefox**: `about:addons` → Gear icon ⚙️ → Manage extension shortcuts
*   **Chrome**: `chrome://extensions/shortcuts`

> [!NOTE]
> On Firefox, the default shortcuts interfere with some browser features. As such, the keyboard combinations will not trigger the Web Clipper action. To fix this, simply change the keyboard shortcut to something that works. The defaults will be adjusted in future versions.

## Configuration

The extension needs to connect to a running Trilium instance. By default, it looks for the desktop application on port 37840 of the local computer. If the desktop application runs on a different port (for example because it was started with the `TRILIUM_PORT` environment variable), enter that port in the extension's options. The extension checks for Trilium again every minute, or right away when pressing the refresh button at the bottom of its popup.

It's also possible to configure the [server](Server%20Installation.md) address if you don't run the desktop application, or want it to work without the desktop application running.

To connect to a server, enter its address and your password in the extension's options and press _Login to the server instance_. If the server uses [multi-factor authentication](Server%20Installation/Multi-factor%20authentication%20with%20TOTP.md), also fill in _Authentication code_ with the current code from your authenticator app (or one of your recovery codes); otherwise leave it empty. The password and the code are used only once, to obtain a token for the extension, and are not stored.

### When a clipping fails

After each clipping, a notification in the corner of the page confirms that it was saved, with a link to open the new note in Trilium. If the clipping could not be saved, the notification says why instead:

*   Trilium was not found: start the desktop application, or check the server address and token in the extension's options.
*   The versions of Trilium and the extension are not compatible: update the one the message names.
*   Trilium rejected the request: the message includes the reason Trilium gave.

The extension downloads the images of a clipping itself, so that they are stored in Trilium together with the note. If some of them cannot be downloaded (for example because the website refuses the request), the clipping is still saved, and the notification says how many images are missing. Those images keep their address on the original website: Trilium tries to download them once more if _Download images automatically_ is enabled in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Media_, and otherwise the note shows them from the website for as long as it serves them.

The notification is shown on the page itself, so it does not appear on pages where extensions cannot run (such as the browser's own settings pages and the extension stores).

## Testing development versions

Development versions are version pre-release versions, generally meant for testing purposes. These are not available in the Google or Firefox web stores, but can be downloaded from either:

*   [GitHub Releases](https://github.com/TriliumNext/Trilium/releases) by looking for releases starting with _Web Clipper._
*   Artifacts in GitHub Actions, by looking for the [_Deploy web clipper extension_ workflow](https://github.com/TriliumNext/Trilium/actions/workflows/web-clipper.yml). Once a workflow run is selected, the ZIP files are available in the _Artifacts_ section, under the name `web-clipper-extension`.

=== "<span class="tn-icon bx bxl-chrome"></span> Chrome"

    1.  Download `trilium-web-clipper-[x.y.z]-chrome.zip`.
    2.  Extract the archive.
    3.  In Chrome, navigate to `chrome://extensions/`
    4.  Toggle _Developer Mode_ in top-right of the page.
    5.  Press the _Load unpacked_ button near the header.
    6.  Point to the extracted directory from step (2).

=== "<span class="tn-icon bx bxl-firefox"></span> Firefox"

    > [!WARNING]
    > Firefox prevents installation of unsigned packages in the “retail” version. To be able to install extensions from disk, consider using _Firefox Developer Edition_ or a non-branded version of Firefox (e.g. _GNU IceCat_).
    > 
    > One time, go to `about:config` and change `xpinstall.signatures.required` to `false`.

    1.  Navigate to `about:addons`.
    2.  Select _Extensions_ in the left-side navigation.
    3.  Press the _Gear_ icon on the right of the _Manage Your Extensions_ title.
    4.  Select _Install Add-on From File…_
    5.  Point it to `trilium-web-clipper-[x.y.z]-firefox.zip`.
    6.  Press the _Add_ button to confirm.

## Credits

Some parts of the code are based on the [Joplin Notes browser extension](https://github.com/laurent22/joplin/tree/master/Clipper).