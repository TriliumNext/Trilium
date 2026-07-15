# Tray icon & automatic startup
> [!NOTE]
> Automatic startup and better integration with the system tray was introduced in v0.104.0. Versions prior to that only have the system tray option which could be found in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Others_.

## Tray icon

<figure class="image image-style-align-right"><img style="aspect-ratio:332/71;" src="Tray icon &amp; automatic startup_image.png" width="332" height="71"></figure>

The desktop application has native integration with the system tray on all operating systems.

The tray icon is enabled by default, but it can be toggled from <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Desktop_.

The tray icon has the following functionality:

*   When clicked, the last window is hidden (minimized to the tray icon). Clicking it again will reveal that window.
*   Right clicking reveals the following options:
    *   Each window can be individually shown or hidden, identified by their active note.
    *   New windows can be opened.
    *   A new note can be created directly, which will be created in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a> (or <a class="reference-link" href="../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a> if an inbox is not available).
    *   Today's day note can be opened.
    *   Bookmarks and recent notes are displayed in a sub-menu and clicking them navigates to that note.
    *   Quitting the application.

### Closing to system tray

This is an option which is not enabled by default and it allows a specific behavior: instead of exiting the application when the last window has been closed, the last window is instead hidden with the tray icon remaining available.

This option requires the tray icon to be enabled, otherwise it has no effect.

## Automatic startup

Two options control the automatic startup functionality in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Startup_:

*   When _Launch on startup_ is enabled, the application will automatically start up when logging into the current user.
    
    *   Note that on Linux support depends on the desktop environment. Feel free to [report](../../Troubleshooting/Reporting%20issues.md) any issues.
*   If _Start minimized to tray_ is also enabled, the application will start up in the background and can be revealed from the tray icon.
    
    *   This only applies if _Launch on startup_ is enabled, manual starts are not impacted by this option.