# Transient notifications: progress of an operation

A transient notification is a card at the top of the panel for an operation that runs now, with a
spinner on the bell. It shows no toast, plays no sound, and is never stored or synced. It lives in
the memory of one backend and reaches only the windows connected to that backend: the browsers of
a server, or the desktop app's own windows. The backend side is
`packages/trilium-core/src/services/notifications/transients.ts`; the client handle is
`ClientTransientHandle` in `apps/client/src/services/notifications.ts`.

## Fields

`createTransientNotification(input)` takes `title`, `description`, `protectedTitle`,
`protectedDescription`, `icon`, `noteId`, `progress`, `progressLabel`, `actions`, `handler` and
`sensitive`. There is no `id` (the handle makes one of 16 characters), no `link`, `tag`,
`category`, `type`, `attentionLevel` or `raisedAt`; the card uses the icon and the title of the
`general` category by default.

`checkTransientInput()` checks each field as for a raise
([stored-notifications.md](stored-notifications.md)). A title is required unless `noteId`,
private text or `sensitive: true` is given, and the whole notification, written as JSON, holds at
most 2 KiB
(`too-large`). A `noteId` of a protected note, or of a note that the backend lacks, makes it
sensitive ([sensitive-notifications.md](sensitive-notifications.md)).

## The handle

`id`, `setTitle()`, `setDescription()`, `setProtectedTitle()`, `setProtectedDescription()`,
`setIcon()`, `setProgress()`, `setProgressLabel()`, `setActions()` and `dismiss()`. A setter
replaces its field, and the whole notification goes out again. A setter after `dismiss()` does
nothing, and so does a second `dismiss()`.

```js
const progress = api.notifications.createTransientNotification({
    title: "Exporting notes",
    progress: 0
});
try {
    for (const [ index, note ] of notes.entries()) {
        await exportNote(note);
        progress.setProgress((index + 1) / notes.length);
        progress.setProgressLabel(`${index + 1} of ${notes.length}`);
    }
} finally {
    progress.dismiss();
}
```

## Limits and lifetime

- **A backend holds at most 20**, and one producer at most 10: a backend script counts by its
  start note, a client by its login session (all frontend scripts in every window of that session
  share it), a built-in feature by its name. Beyond that: `transient-limit`.
- **A client's ends a minute after its last change.** The client handle sends it again every 20
  seconds while its page lives, so it ends about a minute after its window closes or crashes.
- **A backend script's, or core's, lasts until `dismiss()` or until the process ends.** One that is
  never dismissed holds its place until a restart.
- The backend sends changes to its clients at most every 300 ms, merged. A client handle sends at
  most four requests a second, merged, and drops what waits when it is dismissed.

## Backend handle and frontend handle

| | Backend script | Frontend script |
| --- | --- | --- |
| A refused create | `createTransientNotification()` throws `NotificationError` | logs `A notification request failed: transient, <code>.` |
| A refused change | the setter throws; the handle keeps its last accepted state | logged; the handle keeps the refused value, so every later send fails until a setter replaces it |
| Shown | once the script's synchronous run has ended | after its first request, at once |
| Ends | `dismiss()`, or the end of the process | `dismiss()`, or a minute after its last request |

In a frontend script:

- **Pass only values that pass the checks.** Keep `progress` finite and at most 1, never pass an
  empty string to `setIcon()`, keep a `title` unless `noteId` is set, and stay under 2 KiB. A
  refused value stays in the handle and every refresh fails with it, so the card ends a minute
  later unless a setter replaces the value first.
- Call `dismiss()` in `finally`, so that the card ends when the work fails.

In a backend script:

- **A transient notification is for work that goes on after the run**, such as a `fetch()` chain:
  the run is synchronous, so one created and dismissed in the same run never shows.
- Dismiss it in `.finally()` of that chain.
- Wrap the creation and the setters in `try`/`catch` when a refusal must not end the script.

## In core

```ts
const token = getNotificationService().putTransient(id, input, producer);
// A change needs the token that the creation returned.
getNotificationService().putTransient(id, { ...input, progress: 0.5 }, producer, token);
getNotificationService().dismissTransient(id, token);
```

- `putTransient()` creates with the token given, or makes one without it, and replaces with the
  owner token; it returns the owner token. A token is 32 letters and digits, anything else is
  `invalid-input`. An `id` that exists, with a missing or wrong token, is `not-owner`. The `id` is
  a token, and only a built-in producer can start it with `trilium:`.
- A client handle makes its own owner token (`randomSecret()`) and sends it with every request, so
  a creation whose answer was lost is repeated by the next change, and its dismissal still ends it.
- A replacement keeps the producer and the sensitivity of the notification it replaces.
- A built-in producer's transient notification does not expire: end it in `finally`.
- `ScriptTransientHandle` in `services/notifications/script_api.ts` wraps these calls as a handle.

## Actions on a transient notification

A handler receives `notification.type === "transient"`. Its `{ dismiss: true }` or `{ update }`
applies only through the handle of the window that created the notification
(`notificationStore.getOwnTransient()`); elsewhere it is dropped with a console warning. Every
window of the backend shows the card, and shows its buttons wherever a handler of its name is
registered. When only the owner should act, give the handler a name unique to the window, as the
Cancel example of `Scripting/Notifications in scripts.md` does
([action-handlers.md](action-handlers.md)).

## Reconnects and restarts

- After a reconnect, the client loads the list of transient notifications again.
- A backend that restarted holds none of the earlier ones. A client handle sends its notification
  again at its next change or refresh, and the backend takes it as new, with the handle's token.
- A reconnect drops the transient messages that waited for a list, and the answer of a list asked
  before it: their counter belongs to the backend before the restart.
- A backend script's handle does not survive its process: after a restart, nothing ends the
  notification it made, since the notification is gone too.

## Edge cases

- **`setProgress(NaN)`, `setProgress(1.5)`, `setIcon("")`, or `setTitle("")` without `noteId`** are
  refused as `invalid-input`.
- **`getById()` never finds a transient notification**: they are not in the stored view. Client
  UI lists them with `useTransientNotifications()`.
- **Ten long tasks of one login session**, across all its windows, take the producer's share: an
  eleventh is refused until one ends.
- **A frontend script that throws with no `finally` around its work** leaves its card as long as
  its window stays open, since the handle keeps sending it every 20 seconds, and about a minute
  after the window closes. A backend script's card stays until a restart.
- **A transient notification about a protected note** shows its private text only during a
  protected session.
