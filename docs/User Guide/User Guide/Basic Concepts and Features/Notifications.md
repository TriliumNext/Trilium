# Notifications
Notifications tell you about things that need your attention, such as a security notice from Trilium or a reminder from one of your scripts.

Click the <span class="tn-icon bx bx-bell"></span> bell near the right end of the tab bar to see your notifications. On a phone, tap the bell in the <a class="reference-link" href="UI%20Elements/Launch%20Bar.md">Launch Bar</a>. On a tablet, the bell is in the tab bar, as on the desktop.

A number on the bell counts the notifications you haven't seen yet. A dot means you've seen them all, but some are still unread.

## Reading and clearing notifications

*   Click a notification to open its note, when it has one. This also marks it as read.
*   To mark a notification as read, click the dot beside it.
*   To mark the whole list as read, press <span class="tn-icon bx bx-check-double"></span> _Mark all as read_.
*   To remove a notification, right-click it and select <span class="tn-icon bx bx-trash"></span> _Remove_.
*   To remove all notifications, press <span class="tn-icon bx bx-trash"></span> _Clear all_. Notifications that need an answer stay in the list.

Trilium clears older notifications automatically, starting with the ones you've read.

A notification from a script can do something else when you click it, as the script decides.

## Notifications that need an answer

Some notifications stay until you answer them with one of their buttons, for example a reminder with a _Done_ button.

To remove one anyway, right-click it, select <span class="tn-icon bx bx-x-circle"></span> _Dismiss anyway_ and confirm with _Dismiss_. If the script behind its buttons doesn't run on this device, the notification shows a _Dismiss anyway_ button directly.

## Operations in progress

An operation that takes a while can show its progress at the top of the list, for example a script that processes many notes. While it runs, a small circle spins on the bell. These notifications show no toast, and they disappear when the operation ends.

## Toasts and sound

New notifications can also pop up as a toast, with a sound:

*   Most notifications show a toast for a few seconds.
*   High-priority notifications show a toast with no timer. Close the toast or mark the notification as read to clear it. Enabled channels can also forward these notifications; see <a class="reference-link" href="Notifications/Notification%20channels.md">Notification channels</a>.
*   Low-priority notifications only appear in the bell.

Clicking a toast works like clicking the notification in the list. The sound plays unless you turn off _Sound alerts_ in the settings.

To pause toasts and sounds, turn on _Silent_ at the top of the list. Notifications still appear in the bell, which shows <span class="tn-icon bx bx-bell-off"></span> while _Silent_ is on. _Silent_ doesn't sync: browsers connected to the same server share it, and a desktop app has its own.

## Configuration

To change the notification settings, go to <a class="reference-link" href="UI%20Elements/Options.md">Options</a> → _Notifications_. These settings apply to all your devices.

### Sound

_Sound alerts_ plays a sound with each toast. To use a sound of your own, press _Browse..._ under _Custom sound_ and choose an MP3, OGG or WAV file of up to 1 MiB.

### Categories

_Notification categories_ lets you turn off whole groups of notifications: _General_, _Reminders_ and _Software updates_. Notifications of a category that is off are dropped, and turning the category on again doesn't bring them back.

> [!WARNING]
> _General_ includes Trilium's security notices, such as a warning about wrong codes for the second factor. Turning it off drops these notices too.

### Channels

Channels forward important notifications outside Trilium, for example to your phone. See <a class="reference-link" href="Notifications/Notification%20channels.md">Notification channels</a>.

## Protected notes

A notification about a [protected note](Notes/Protected%20Notes.md) keeps its details private. Open the protected session to see them. Until then, Trilium shows a general message, or the public text that the script supplied.

## Using several devices

Notifications sync between your devices. A notification you read or remove on one device is read or removed on the others too.

## Notifications from scripts

Scripts can raise notifications, give them buttons and show the progress of their work. See <a class="reference-link" href="../Scripting/Notifications%20in%20scripts.md">Notifications in scripts</a>.