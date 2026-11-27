# Producers: who raises, and through which API

Every raise names a producer. It is stored in the `producer` column, and the card shows it as the
source of the notification.

| | Built in | Script | Client |
| --- | --- | --- | --- |
| `producer` value | `trilium:<area>` | `script:<noteId>` of the start note | `client` |
| IDs, tags, handlers starting with `trilium:` | allowed | `reserved-name` | `reserved-name` |
| Raises and updates in a minute | 30; then raises are queued, updates still apply | 30, then `budget` | 30 per session, then `budget` |
| All producers that are not built in, in a minute | not counted | 120 together | 120 together |
| Raises and updates in a day | not counted | 500, then `daily-budget` | 500 per session |
| Stored notifications at which a new raise is `full` | 1,000 | 800 | 800 |
| Runs a client handler named `trilium:…` | yes | no | no |
| Share of a channel's 30 sends an hour | first, up to 30 | 10 each, 20 together | 10, within the 20 |

The budgets live in the memory of the service, so a restart resets them. The panel lists the
producers that reached their daily budget (`counts.dailyBudgetReached`).

## Built-in features in core

```ts
import { t } from "i18next";

import type BNote from "../../becca/entities/bnote.js";
import { getLog } from "../log.js";
import { getNotificationService } from "../notifications/index.js";
import { formatUtcDateTime, NotificationError } from "../notifications/model.js";
import type { NotificationProducer } from "../notifications/service.js";

const REMINDERS: NotificationProducer = { kind: "built-in", name: "trilium:reminders" };

/** Raises the reminder of a note once for its due time. */
export function raiseReminder(note: BNote, dueMs: number) {
    try {
        const { outcome } = getNotificationService().create({
            id: `trilium:reminders:${note.noteId}`,
            raisedAt: formatUtcDateTime(dueMs),
            noteId: note.noteId,
            category: "reminder",
            type: "persistent",
            attentionLevel: "high",
            handler: "trilium:reminders",
            actions: [ { id: "done", caption: t("reminders.done"), icon: "bx bx-check" } ]
        }, REMINDERS);
        return outcome;
    } catch (e) {
        const code = e instanceof NotificationError ? e.code : "internal";
        getLog().error(`Could not raise a reminder: ${code}.`);
        return null;
    }
}
```

- **Import `getNotificationService()` from `services/notifications/index.js` and call it inside a
  function.** The service is made at its first use, because the notification modules and
  `options`, `options_init`, `device_records` and `ws` import each other in a cycle.
- **`create(input, producer)` is synchronous** and returns `{ outcome, notification }`:

  | `outcome` | `notification` | Meaning |
  | --- | --- | --- |
  | `new` | the new generation | written; the older generations of the `id` are erased; an alert is queued |
  | `stored` | the stored generation | the same `id` and `raisedAt` are stored already; the raise can only add sensitivity and fill a missing private text |
  | `erased` | `null` | that generation, or a later one, was dismissed |
  | `late` | `null` | a later generation of the `id` is stored |
  | `categoryOff` | `null` | the user turned the category off; nothing is stored |
  | `queued` | `null` | over the budget of 30 a minute; a timer raises it later |

  A queued raise is written once the budget allows, in its order. Its outcome reaches nobody, and
  a refusal at that time is only logged as `Notification task queued-raise failed: <code>.`
- **It throws `NotificationError`**, whose `message` is its `code`, for a check that fails and for
  `full`. Every check runs before the first write, so a refusal leaves nothing behind.
- **It needs a CLS context.** A request handler has one. A timer, a scheduler job, an Electron IPC
  handler or startup code wraps the call in `cls.init(() => ...)` (`services/context.ts`).
- **It needs Becca.** The service reads the stored generations from Becca, so raise only once
  Becca has loaded. `startNotifications()` runs after `beccaLoaded` on the server, the desktop and
  in the standalone worker.
- **It joins the caller's transaction.** A rollback of the caller takes the raise with it. The
  alert is decided from what is stored after the transaction, so a rolled-back raise alerts nobody.
- **The text is stored as passed.** Translate it with `t()` from the server catalogue
  (`apps/server/src/assets/translations/en/server.json`) when raising. Every device then shows the
  language of the instance that raised it. With `noteId` and no `title`, the card shows the note's
  current title and nothing of the title is stored.
- **Names**: producer `trilium:<area>`, IDs `trilium:<area>:<key>`, the handler
  `trilium:<area>`, tags `trilium:<area>:<group>`. The producer name must be a token too, or the
  row fails its check (`invalid-row`).
- **Log refusals by code.** Never put input or row text into a log line or an error message: the
  notification code never builds a message from either.
- **The other methods of the service:** `update(id, patch, producer, expected?)` returns the
  notification, or throws `not-found` or `stale-revision`; a built-in producer's update is never
  refused for its budget. `dismissById(id)` erases the current generation. `dismiss(refs, reason)`
  returns `{ refused }`. `getById(id)`, `getByTag(tag)`. `putTransient()` and `dismissTransient()`
  are in [transient-notifications.md](transient-notifications.md).
- **References in the code:** `raiseSecurityNotice()` (producer `trilium:security`, `high`, with a
  link to the sign-in settings) and `raiseChannelNotice()` (producer `trilium:notifications`,
  `medium`) in `services/notifications/index.ts`.

## Backend scripts

`api.notifications` of a backend script is `createScriptNotificationApi()` of
`services/notifications/script_api.ts`, with the start note as the producer
(`script:<startNote.noteId>`). A function that a frontend script runs with `api.runOnBackend()`
therefore counts as the frontend script's note, under the budgets of a script.

```js
api.notifications.create({
    id: `todo-count:${new Date().toISOString().slice(0, 10)}`,
    title: `${api.searchForNotes("#todo").length} notes still have a #todo label`,
    attentionLevel: "low"
}).catch((e) => api.log(`The notification was refused: ${e.message}`));
```

- **Each method returns a promise but acts at once.** A backend script cannot `await` at the top
  level and does not need to: the write is done when the call returns. A refusal rejects the
  promise, so add `.catch()`; without one, the server reports an unhandled promise rejection
  whose message is the bare code.
- `create()` resolves to the notification, or to `null` for a category that is off, an erased
  generation and a late one.
- `update()` resolves to `null` for `not-found` and `stale-revision` and rejects for the other
  codes.
- `dismiss(id)` erases the current generation, persistent ones too, and does nothing for an `id`
  without one. `dismiss({ id, raisedAt })` erases that generation only.
- **A run inside a transaction takes its notifications back when it throws.** The _Execute_
  button and `api.runOnBackend()` run a script in a transaction, so a throw after `create()`
  leaves no notification.
- `createTransientNotification()` and the setters of its handle throw synchronously
  ([transient-notifications.md](transient-notifications.md)).
- There is no `registerActionHandler()`: a frontend script registers the handler of the buttons of
  a backend notification.
- Backend scripts run only with `backendScriptingEnabled` on.
- **A custom request handler opens the bell to the network.** A `#customRequestHandler` script that
  raises notifications lets whoever reaches its URL raise them, and a `high` one goes on through
  the channels to the user's phone. Check a secret of the request before raising.
- **A scheduled script runs on every device** (`#run=hourly`, `#run=daily`). Either restrict it
  with `#runOnInstance`, or give the event the same `id` and `raisedAt` on every device so that
  they store one generation.

## Frontend scripts

`api.notifications` of a frontend script is `scriptNotifications` in
`apps/client/src/services/frontend_script_api.ts`: the client store behind the REST routes, with
the producer `client`.

- Every client is the producer `client`, and each session has budgets of its own: 30 a minute and
  500 a day. All of them draw from the 120 a minute of the producers that are not built in.
- **`await create()` resolves once the store holds the notification**: the store waits for the
  entity changes of the write, so a `getById()` right after finds it. It resolves to `null` for a
  category that is off, an erased generation and a late one.
- A refusal rejects with `NotificationRequestError`. Its `code` is the code, and so is its
  `message`.
- **`getById()` and `getByTag()` read the store's view** of this backend, after its first load,
  and never ask the backend.
- `dismiss(id)` erases the generation that the store shows for the `id`. A generation that has not
  reached this backend yet is not dismissed. It erases persistent notifications too.
- `registerActionHandler(name, handler)` throws `NotificationRequestError` synchronously for a
  name that is not a token (`invalid-input`) and for one that starts with `trilium:`
  (`reserved-name`) ([action-handlers.md](action-handlers.md)).
- `createTransientNotification()` returns its handle at once and never throws
  ([transient-notifications.md](transient-notifications.md)).

## Client code

Built-in UI goes through the store, `apps/client/src/services/notifications.ts`:

```ts
import notificationStore from "../services/notifications";
import { useNotificationCount, useNotifications } from "./react/hooks/notifications";
```

- The store module loads at startup. The store starts after the tabs load, loads the view in pages
  of 200 and follows the entity changes that `froca_updater.ts` hands it.
- Signals: `notifications` (newest first), `counts`, `isLoaded`, `pendingCount`, `unreadCount`,
  `transients`, `actionHandlers`. Hooks: `useNotifications()`, `useNotificationCount()`,
  `useTransientNotifications()`, `useNotificationActionHandler(name)`.
- Beyond `NotificationApi`: `markSeen()` and `markRead()` (the view shows the mark at once, the
  requests go out after 500 ms, and a failure reloads the view), `markAllAsRead()`, `clearAll()`
  (standard notifications only), `remove()` (reason `user`), `dismissAnyway()` (reason `force`),
  `whenLoaded()`, `waitFor(notificationId, timeoutMs)`, `reload()` and `getOwnTransient(id)`.
- Imports follow the Shared Types Policy of `CLAUDE.md`: types through `import type` from
  `@triliumnext/commons`, values from `@triliumnext/commons/src/lib/notifications.js` and
  `@triliumnext/commons/src/lib/notification_channels.js`.
- `notification_display.ts`, `notification_alerts.ts` and `notification_channels.ts` load on first
  use. A static import of one of them from a module that loads at startup adds requests that
  `pnpm dev:check-startup` reports (measure-startup-requests skill); import them with `import()`.
- **Client code raises as `client`.** It cannot use `trilium:` IDs, and its notifications never
  run a built-in handler. When the user starts a built-in feature in the client, the feature's own
  route raises its notifications in core.
- A built-in handler registers on the store itself; the store does not check the prefix, the
  script API does ([action-handlers.md](action-handlers.md)).
- For a request of your own to a notification route, pass `SILENT_REFUSALS` (exported by the store
  module) to the `server.*` call so that a refusal shows no error toast, and read its code with
  `getErrorCode()`.

## REST routes

All are under `/api` and shared by core, so they run in standalone too. A refusal answers
`{ code }`: 404 for `not-found`, 409 for the codes in `STATUS_OF_CODE` of
`routes/api/notifications.ts`, 400 for the others. An unexpected failure is thrown again as
`internal`: the server answers 500 with `{ message: "internal" }`, which `getErrorCode()` of the
client reads as the code `internal`. Every route answers `not-initialized` (409) until the
database has opened. There is no ETAPI endpoint for notifications.

| Route | Body | Answer |
| --- | --- | --- |
| `GET notifications?after=<notificationId>` | | a page of 200, newest first, with `next` and `changeId`; the first page adds `counts`, `transients` and `transientSeq` |
| `POST notifications` | `NotificationInput` | `{ notification }`, `null` when none is stored; 409 `category-off` |
| `PATCH notifications/:id` | `{ patch, expected? }` | `{ notification }` |
| `POST notifications/state` | `{ refs, state }`, `state` is `seen` or `read` | 204 |
| `POST notifications/dismiss` | `{ refs, reason }`, `reason` is `user`, `handler` or `force` | `{ refused }` |
| `PUT notifications/transient/:id` | `{ notification, token? }` | `{ token }` |
| `DELETE notifications/transient/:id` | `{ token }` | 204 |

`refs` holds at most 500 `{ id, raisedAt }` pairs. The channel routes are in
`routes/api/notification_channels.ts`; [built-in-channel-types.md](built-in-channel-types.md) lists
the ones that a new type uses.

## WebSocket messages

`packages/commons/src/lib/ws_api.ts` declares the four messages of notifications, which the store
handles; it also loads the view again on `protectedSessionLogin`, so that private texts show. A
component reads the store, never the socket.

| Message | Meaning |
| --- | --- |
| `notification-alert` | Show the toast of one generation, and play the sound in one tab of each browser profile. |
| `notifications-due` | A row dated ahead came within the hour; the store loads the view again. |
| `transient-notifications` | Changed and ended transient notifications, with a `seq`; a gap loads the list again. |
| `notification-forward` | A delivery of a frontend channel that a tab can claim. |

## Edge cases

- **A raise inside a loop draws from the budget of a minute.** 30 raises, or updates, of one
  script in a minute, and the 31st is refused with `budget`. Raise one summary notification
  instead, or spread the raises.
- **The budget toast.** A raise refused for a budget sends one toast to every window, at most once
  a minute, and one log line. A script that ignores the refusal keeps hitting it silently after
  that.
- **Several sessions of one user** (two browsers) each have their own client budget, but share the
  120 a minute.
- **A built-in raise in a category that is off** is dropped like any other. No category is exempt:
  turning _General_ off drops Trilium's security notices too. Pick the category whose switch the
  user would expect to silence the feature.
- **A built-in producer over its budget never throws**: the raise waits in a queue that a restart
  loses.
