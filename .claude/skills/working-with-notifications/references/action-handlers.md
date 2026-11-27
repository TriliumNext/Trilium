# Action handlers: buttons and clicks

A notification gets buttons from its `actions` and the name of its `handler`. A handler is a
function registered in a window of the client; it runs when a button, the card or the toast is
pressed. The rules are in `apps/client/src/services/notification_display.ts`
(`getRunnableHandler()`, `getShownActions()`, `runNotificationAction()`).

## When buttons show

A card or a toast shows the actions only where a handler of the notification's name is registered
in that window. Otherwise they stay hidden, and the console says why, once per notification:

- `Notification actions are available only when the "handler" property is specified`
- `Notification action handler <name> not registered`

A persistent notification without a handler in the window shows _Dismiss anyway_ on its card,
which asks for a confirmation and then dismisses it with the reason `force`.

## Registering

```js
api.notifications.registerActionHandler("tasks:reminder", async ({ action, notification }) => {
    if (action === null) {
        await api.activateNote(notification.noteId);
        return;
    }
    if (action.id === "done") {
        await api.setLabel(notification.noteId, "status", "Done");
        return { dismiss: true };
    }
});
```

- **The name is a token**, and a name that starts with `trilium:` is refused: `invalid-input` or
  `reserved-name`, thrown synchronously as `NotificationRequestError`.
- **One handler per name and window.** Registering a name again replaces its handler. Buttons
  appear as soon as a handler is registered, on cards already shown too; a toast keeps the buttons
  it was shown with until its notification changes.
- **It lives in its window until the window reloads.** To register it in every window at every
  start, give its note `#run=frontendStartup` and `#run=mobileStartup`.
- **Name it after the script, not after one notification.** One handler serves every notification
  that names it: tell them apart by `notification.id`, `notification.tag` or `action.id`.

## What the handler receives

`{ action, notification }`:

- `action` is the pressed `{ id, caption, icon? }`, or `null` for a click on the card or the
  toast, the default action.
- `notification` is the notification as this window's store has it (`TriliumNotification`), or a
  transient one, whose `type` is `"transient"`.

**With a handler, the default action is the handler's.** A click on the card no longer opens the
note or the link; the handler decides, for example with `api.activateNote(notification.noteId)`.
Without a handler, a click opens the link, or the note, in a tab that shows it or a new one, and
marks the notification read.

## What it returns

| Result | Standard | Persistent | Transient |
| --- | --- | --- | --- |
| nothing, or anything else | marked read | unchanged | unchanged |
| `{ dismiss: true }` | the generation it received is dismissed | the same | ended, through its own handle |
| `{ update: patch }` | changed, unless it changed in between | the same | changed, through its own handle |

- **A dismissal names the generation that the handler received.** When the notification was
  raised again in the meantime, the new generation stays.
- **An update is dropped when the notification changed while the handler ran**: its `revision` is
  compared, so another device, another handler, or a raise that filled its private text drops the
  patch. The console says so.
- With `{ dismiss: true, update: … }` the dismissal wins.
- **A handler that throws** leaves the notification as it was; a toast says that the action
  failed, and the error is in the console. A refused result of a stored notification, such as a
  patch that fails its check or a budget, shows the same toast, with the code in the console. For
  a transient notification the patch goes through the handle's setters, so a refusal is only
  logged ([transient-notifications.md](transient-notifications.md)).
- A result syncs: a press on one device changes the notification on all of them.

## Built-in handlers

A built-in feature registers its handler on the store, which does not check the prefix:

```ts
import notificationStore from "../services/notifications";

notificationStore.registerActionHandler("trilium:reminders", handleReminderAction);
```

- A `trilium:` handler runs only for a notification whose `id` starts with `trilium:` **and**
  whose producer is built in. A script's notification that names a `trilium:` handler gets no
  buttons and no console message, so a script cannot borrow a built-in handler.
- Register it from a module that loads at startup anyway: a new eager import shows in
  `pnpm dev:check-startup` (measure-startup-requests skill). Keep the handler itself light, and load
  heavy code inside it with `import()`.
- The core side raises with `handler: "trilium:<area>"` and IDs `trilium:<area>:<key>`
  ([producers.md](producers.md)).

## Buttons on a backend notification

A backend script, or core, raises the notification with `actions` and `handler`, and the client
registers the handler: a frontend script, or the store for a built-in one. On a device where no
window registered it, the buttons stay hidden.

## Sensitive notifications

When the raise passed no private text, the captions are not public: the buttons show "Action 1",
"Action 2" by their position, and the handler still receives each `action.id`
([sensitive-notifications.md](sensitive-notifications.md)).

## Edge cases

- **A second press runs the handler again.** Buttons are not disabled while a handler runs, so a
  handler that writes must tolerate a repeat: check the state it is about to change first.
- **A handler registered in one window only**: other windows show the card without buttons, and a
  persistent notification offers _Dismiss anyway_ there.
- **A transient notification's buttons show in every window of its backend** that has the handler.
  Give the handler a name unique to the window when only the owner should act
  ([transient-notifications.md](transient-notifications.md)).
- **A handler that only navigates** and returns nothing marks a standard notification read. An
  empty `{ update: {} }` leaves it unread, but still rewrites the row, which syncs and draws from
  the client's budget. A notification that must stay until it is answered is better persistent.
- **A notification without `noteId`, `link` or a handler** is not clickable at all.
- **Errors in a patch**: `{ update: { icon: "" } }` is refused as `invalid-input`. For a stored
  notification a toast says that the action failed; for a transient one the refusal is only
  logged, and the handle keeps the empty icon until a setter replaces it.
- **A handler of a notification that was dismissed elsewhere** while it ran: its dismissal does
  nothing, and its update is refused as `not-found` and dropped.
