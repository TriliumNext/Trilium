---
name: working-with-notifications
description: Use when code or a script raises, changes, reads or dismisses notifications of the bell, as a consumer of the notification API. Covers built-in features in `packages/trilium-core` (`getNotificationService().create()` with a `trilium:<area>` producer), client code (`notificationStore`, `useNotifications()` and the other hooks), frontend and backend scripts (`api.notifications`), progress cards (`createTransientNotification()`), buttons and their handlers (`registerActionHandler()`, `{ dismiss }` and `{ update }` results, built-in `trilium:` handlers), notifications about protected notes (sensitive notifications, `protectedTitle`), and custom notification channels, both script channels on the frontend or the backend (`#notificationChannel`, `api.notification`, `api.delivery`, `api.channelSettings`, `~configWidget`) and new built-in channel types (`NotificationChannelType`, `registerChannelType()`, the webhook as the reference). Explains every field check, IDs and generations (update in place, replace, one event on several devices, raise once), every refusal code, the budgets and limits, what a channel forwards and when, retries and duplicates, the edge cases of each surface, and the spec fixtures. Not for changing the notification system itself (sync rules, marks, the delivery record, the sequences of channel switchings).
---

# Working with notifications

The bell and its panel show notifications. A **stored notification** is a synced row that every
device shows. A **transient notification** is a progress card that lives in the memory of one
backend. A **channel** forwards `high` notifications outside Trilium.

This skill is the consumer side: how a built-in feature, client code or a script raises, changes,
reads and dismisses notifications, gives them buttons, shows progress, and how to write a custom
channel, as a script or as a built-in type. It does not cover changing the system itself (the sync
rules, marks, the delivery record, channel switchings); for that, read
`packages/trilium-core/src/services/notifications/` and its specs.

What the user sees is in the User Guide: `Basic Concepts and Features/Notifications.md`,
`Basic Concepts and Features/Notifications/Notification channels.md` and
`Scripting/Notifications in scripts.md`. A change of behavior updates them in the same change
(writing-documentation skill).

## The model

| Term | Meaning |
| --- | --- |
| `id` | The caller's name for a notification: `[A-Za-z0-9_.:-]`, 1 to 100 characters. Generated when absent. |
| generation | One raise of an `id` at one `raisedAt`. Its key is `notificationId`. The view shows the newest generation of each `id`. |
| `state` | `pending`, then `seen`, then `read`. A mark is written once and never goes back. |
| `type` | `standard`, or `persistent`: _Remove_ and _Clear all_ leave it; its handler, the API's `dismiss()`, _Dismiss anyway_ and deleting its note remove it. |
| `attentionLevel` | `low` counts on the bell. `medium` adds a 10-second toast and a sound. `high` adds a toast that stays, and channels forward it. |
| `category` | `general`, `reminder` or `softwareUpdate`. A raise in a category that the user turned off stores nothing. |
| sensitive | About a protected note, about a note that the instance lacks, or named so. Its text moves to an encrypted private text. |
| producer | Who raised it: `trilium:<area>` (built in), `script:<noteId>` or `client`. It decides the budgets, the reserved names and the built-in handlers. |
| transient | A progress card of one backend. Never stored, never synced. |
| channel | Forwards `high` notifications: a code note with `#notificationChannel`, or a built-in type such as `webhook`. |

## Pick the surface

| You are writing | Use | Read |
| --- | --- | --- |
| A built-in feature in core | `getNotificationService().create(input, { kind: "built-in", name: "trilium:<area>" })` | [producers](references/producers.md) |
| A backend script | `api.notifications` | [producers](references/producers.md) |
| A frontend script | `api.notifications`, with `registerActionHandler()` | [producers](references/producers.md), [action handlers](references/action-handlers.md) |
| Client UI | `notificationStore` and the hooks of `widgets/react/hooks/notifications.ts` | [producers](references/producers.md) |
| Progress of an operation | `createTransientNotification()` | [transient notifications](references/transient-notifications.md) |
| Buttons on a notification | `actions`, `handler` and a registered handler | [action handlers](references/action-handlers.md) |
| A notification about a protected note | `noteId`, `protectedTitle`, `sensitive` | [sensitive notifications](references/sensitive-notifications.md) |
| Forwarding with a script | a code note with `#notificationChannel` | [channel scripts](references/channel-scripts.md) |
| A new built-in channel type | `NotificationChannelType`, its registration and a dialog | [built-in channel types](references/built-in-channel-types.md) |
| Handling a refusal | `NotificationError.code`, `NotificationRequestError.code` | [errors and limits](references/errors-and-limits.md) |
| Specs | the core, forwarder and client fixtures | [testing](references/testing.md) |

## Reference files

- [references/producers.md](references/producers.md): the four ways to raise (core, backend
  script, frontend script, client code), what each returns and throws, CLS and transactions, the
  REST routes and the WebSocket messages.
- [references/stored-notifications.md](references/stored-notifications.md): each field and its
  check, IDs and generations, the outcomes of a raise, updates, dismissals, reads, alerts, the
  history and the limits of an instance.
- [references/sensitive-notifications.md](references/sensitive-notifications.md): what makes a
  notification sensitive, what stays public, the private text and the protected session, what a
  card and a channel show.
- [references/transient-notifications.md](references/transient-notifications.md): the handle, its
  limits and lifetime, and how a backend handle and a frontend handle differ on a refusal.
- [references/action-handlers.md](references/action-handlers.md): when buttons show, registering
  a handler, the default action, results, built-in handlers.
- [references/channel-scripts.md](references/channel-scripts.md): writing a backend or a frontend
  channel script and its `~configWidget`: what qualifies, the payload, retries, budgets, duplicates,
  what stops a channel. Two complete examples.
- [references/built-in-channel-types.md](references/built-in-channel-types.md): the
  `NotificationChannelType` contract, registration per runtime, addresses and secrets, the client
  dialog, with the webhook as the reference.
- [references/errors-and-limits.md](references/errors-and-limits.md): every error code with its
  HTTP status and cause, the delivery codes and skip reasons, every limit and where it is defined.
- [references/testing.md](references/testing.md): the fixtures of the core, forwarder and client
  specs, and their traps.

## Rules that bite

1. **A raise without `raisedAt` is always new.** It is dated after the newest generation of its
   `id`, dismissed ones included, so a reminder raised again at every run comes back after the user
   dismissed it. To raise an event once, pass its own time as `raisedAt`: after a dismissal, the
   same `id` and `raisedAt` give `null`.
   ([stored notifications](references/stored-notifications.md))
2. **`raisedAt` is `YYYY-MM-DD HH:mm:ss.SSSZ`, with a space.** `toISOString()` writes a `T` and is
   refused as `invalid-input`; `.replace("T", " ")` fixes it. More than an hour ahead is
   `raised-ahead`.
3. **A `noteId` that the instance does not hold makes the notification sensitive** (a typo, or a
   note that has not synced yet), and the mark syncs to every device. Its text moves to the private
   text, which is dropped without a protected session.
   ([sensitive notifications](references/sensitive-notifications.md))
4. **`update()` is not for progress.** Each call syncs and draws from the producer's budget of 30 a
   minute. Show progress with a transient notification.
5. **`update()` changes the text, icon, progress and actions only.** `type`, `category`,
   `attentionLevel`, `noteId`, `link`, `tag` and `handler` need a new raise, and an icon or a
   progress bar cannot be removed. A patch with another field is accepted and the field ignored.
6. **Only `high` notifications are forwarded**, and only within 23 hours of their `raisedAt`. The
   grace time counts from `raisedAt`, not from the raise.
   ([channel scripts](references/channel-scripts.md))
7. **Buttons show only where a handler of that name is registered**, window by window. A `trilium:`
   handler runs only for a notification with a `trilium:` ID from a built-in producer.
   ([action handlers](references/action-handlers.md))
8. **A backend script's methods return promises but act at once**, and a refusal rejects, so add
   `.catch()`. Its transient handle throws synchronously instead. A frontend transient handle never
   throws, and keeps a refused value, so every later send fails until a setter replaces it.
   ([transient notifications](references/transient-notifications.md))
9. **A frontend channel runs once per browser profile on every device**, never retries, and skips a
   delivery while no window is open. Make the receiver ignore repeats of `api.notification.key`.
10. **A backend channel forwards only from the forwarding instance** (the one without a sync
    server), needs backend scripting there, and must `return` its promise and pass
    `api.delivery.signal`. A test send runs it on the backend of the window that pressed it.
11. **Any change to a channel's bundle stops the channel** until the user reviews it and enables it
    again: the content, title or attributes of its note or of any child note that the bundle
    includes.
12. **The `trilium:` prefix belongs to built-in producers** (IDs, tags, handlers). Client code
    raises as `client`, so a built-in feature raises its notifications in core.
13. **At 800 stored notifications, an instance takes nothing new from scripts and clients** (from
    built-in producers at 1,000), not even the replacement of an existing `id`. Persistent
    notifications are never trimmed, so they fill it.

## Where the code is

| Path | Holds |
| --- | --- |
| `packages/commons/src/lib/notifications.ts` | types, constants, error codes, `NotificationApi`, `FrontendNotificationApi` |
| `packages/commons/src/lib/notification_channels.ts` | payload, delivery, channel views, delivery codes, limits |
| `packages/commons/src/lib/script_api.ts` | the `Script*` types of the script API reference, drift-guarded against the above |
| `packages/trilium-core/src/services/notifications/index.ts` | `getNotificationService()`, the built-in notices |
| `packages/trilium-core/src/services/notifications/service.ts` | raises, updates, dismissals, budgets, alerts, housekeeping |
| `packages/trilium-core/src/services/notifications/model.ts` | the checks (`checkInput()`, `checkPatch()`, `checkTransientInput()`), `NotificationError` |
| `packages/trilium-core/src/services/notifications/script_api.ts` | `api.notifications` of backend scripts |
| `packages/trilium-core/src/services/notifications/transients.ts` | the transient notifications of a backend |
| `packages/trilium-core/src/services/notifications/channels/` | channel types and registry, script channels, payload, body template, forwarder |
| `packages/trilium-core/src/routes/api/notifications.ts` | the notification routes, `STATUS_OF_CODE` |
| `packages/trilium-core/src/routes/api/notification_channels.ts` | the channel routes |
| `apps/server/src/services/notifications/` | the webhook type, its secrets file, the delivery record file |
| `apps/client/src/services/notifications.ts` | the client store, `NotificationRequestError` |
| `apps/client/src/services/notification_display.ts` | text, icon, shown actions, `runNotificationAction()` (lazy) |
| `apps/client/src/services/notification_channels.ts` | the frontend channel runner and the card's requests (lazy) |
| `apps/client/src/services/frontend_script_api.ts` | `api.notifications` of frontend scripts |
| `apps/client/src/widgets/notifications/` | the bell, the panel, the card |
| `apps/client/src/widgets/type_widgets/options/notification_channels/` | the channels card and its dialogs |
