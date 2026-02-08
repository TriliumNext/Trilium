# Mobile Frontend
<figure class="image image_resized image-style-align-right" style="width:33.52%;"><img style="aspect-ratio:1242/2688;" src="Mobile Frontend_IMG_1765.PNG" width="1242" height="2688"></figure>

Trilium has a mobile web frontend which is optimized for touch based devices - smartphones and tablets. It is activated automatically during login process based on browser detection.

Mobile frontend is limited in features compared to the full desktop version. See below for more details on this.

## Layout basics

Unlike the desktop version, the mobile version has a slightly different UI meant to better fit the constrained screens of a mobile phone.

Here is a non-exhaustive list of differences between the desktop version and the mobile one:

*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> is displayed as a sidebar. To display the sidebar, press the button in the top-left of the screen.
    
    *   There is also a swipe gesture that can be done from the left of the screen, but the browser's navigation gesture interferes with it most of the time (depending on the platform).
    *   Press and hold a note to display the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree/Note%20tree%20contextual%20menu.md">Note tree contextual menu</a>.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20search.md">Quick search</a> bar is also displayed at the top of the note tree.
*   The full <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> function can be triggered either from either the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> or from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, if configured.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a> is displayed at the bottom of the screen.
    
    *   The launch bar uses a different configuration for icons than the desktop version. See the dedicated page for more information on how to configure it.
*   Most of the note-related actions are grouped in the horizontal dots icon on the top-right of the note.
*   The <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Tabs.md">Tabs</a> are grouped under a tab switcher in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, where the tabs are displayed in a full-screen grid with preview for easy switching, as well as additional options such as reopening closed tabs.
*   Since v0.100.0, <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Split%20View.md">Split View</a> can also be used in mobile view, but with a maximum of two panes at once. The splits are displayed vertically instead of horizontally.
*   Starting with v0.102.0, the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/New%20Layout.md">New Layout</a> is enforced on mobile. This brings features such as the note badges, note type switcher or collection properties which would otherwise not be available.

## Installing as a PWA

The mobile view can be set up as a PWA. While this does not offer any offline capabilities, it will display the application in full-screen and makes it easy to access via your mobile phone's home screen.

### On iOS with Safari

1.  Open your default web browser and access your Trilium instance.
2.  Login.
3.  Press the \[…\] button in the bottom-right of the screen and select Share.
4.  Scroll down to reveal the full list of items and choose “Add to Home Screen”.
5.  Press “Add” and the web app will be available.

### On Android with Google Chrome

> [!IMPORTANT]
> Google Chrome requires the server to be served over HTTPS in order to display in full-screen. If using HTTP, the app will appear like a normal web page (similar to a bookmark).

1.  Open your default web browser and access your Trilium instance.
2.  Login.
3.  Press the three vertical dots icon in the top-right of the screen and select _Add to Home screen._
4.  Select the _Install_ option.
5.  Select an appropriate name.
6.  The web app will appear as an application, not on the home screen.

### On Android with Brave

> [!IMPORTANT]
> Brave requires the server to be served over HTTPS in order to display in full-screen. If using HTTP, the app will appear like a normal web page (similar to a bookmark).

1.  Open your default web browser and access your Trilium instance.
2.  Login.
3.  Press the three vertical dots icon in the bottom-right of the screen and select _Add to Home screen_.
4.  Press the _Install_ option.
5.  The web app will appear as an application, not on the home screen.

### On Samsung Browser

1.  Open your default web browser and access your Trilium instance.
2.  Login.
3.  Press the hamburger menu in the bottom-right of the screen.
4.  Select _Add to_, followed by _Home screen_.
5.  Press _Add_ and the web app will appear on the home page.

## Testing via the desktop application

If you are running Trilium without a dedicated [server installation](Server%20Installation.md), you can still test the mobile application using the desktop application. For more information, see <a class="reference-link" href="Desktop%20Installation/Using%20the%20desktop%20application%20.md">Using the desktop application as a server</a>. To access it go to `http://<ip>:37840/login?mobile` .

## Forcing mobile/desktop frontend

Trilium decides automatically whether to use mobile or desktop front-end. If this is not appropriate, you can use `?mobile` or `?desktop` query param on **login** page (Note: you might need to log out).

Alternatively, simply select _Switch to Mobile/Desktop Version_ in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>.

## Scripting

You can alter the behavior with <a class="reference-link" href="../Scripting.md">Scripting</a>, just like for normal frontend. For script notes to be executed, they need to have labeled `#run=mobileStartup`.

Custom <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a> widgets are also supported.