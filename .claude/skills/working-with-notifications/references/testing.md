# Testing code that uses notifications

General patterns are in the writing-unit-tests skill; this file is what is special about
notifications. Core specs run under two runners, so a change to core runs both:

```bash
pnpm --filter server test notifications       # node + better-sqlite3
pnpm --filter standalone test notifications   # sqlite-wasm in a worker-shaped scope
pnpm --filter @triliumnext/client test notification
```

The trailing argument is a substring of the spec paths: pass the name of your own spec.

## Specs to read first

| Spec | Shows |
| --- | --- |
| `packages/trilium-core/src/services/notifications/service.spec.ts` | a private service with a recording transport, raises, budgets, alerts, sensitivity |
| `packages/trilium-core/src/services/notifications/transients.spec.ts` | transient notifications, tokens, limits, expiry |
| `packages/trilium-core/src/routes/api/notifications.spec.ts` | the routes through `CoreApiTester` |
| `packages/trilium-core/src/services/notifications/channels/forwarder.spec.ts` | a forwarder with a spec channel type, script channels, deliveries |
| `packages/trilium-core/src/services/notifications/scenarios.spec.ts` | two databases that sync, through `SyncInstances` (`src/test/sync_instances.ts`) |
| `apps/server/src/routes/api/notifications_http.spec.ts` | the routes over Express |
| `apps/server/src/services/notifications/webhook.spec.ts` | a built-in type's `send()` |
| `apps/client/src/services/notifications.spec.ts` | the store, with `ws.js` mocked |
| `apps/client/src/services/notification_display.spec.ts` | handlers, results, the default action |
| `apps/client/src/test/notification_channels.ts` | `makeChannel()`, `makeWebhook()`, `makeForwarding()`, `makeList()` for the channels card |

## Core: a feature that raises

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import * as cls from "../context.js";
import { getNotificationService } from "../notifications/index.js";
import { getSql } from "../sql/index.js";
import ws from "../ws.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records"
];

beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    cls.init(() => getSql().transactional(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
            getSql().execute("DELETE FROM entity_changes WHERE entityName = ?", [ table ]);
        }
    }));
    becca.notifications = {};
    becca.notificationMarks = {};
    becca.notificationPrivateTexts = {};
    becca.notificationChannelRecords = {};
});

afterEach(() => {
    getNotificationService().stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it("raises the reminder once and alerts", () => {
    const send = vi.spyOn(ws, "sendMessageToAllClients");
    const note = createNote();
    expect(cls.init(() => raiseReminder(note, NOW))).toBe("new");
    expect(cls.init(() => raiseReminder(note, NOW))).toBe("stored");

    vi.advanceTimersByTime(0);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "notification-alert" }));
});
```

`raiseReminder()` is the feature's function from [producers.md](producers.md); `createNote()` stands
for a helper that calls `noteService.createNewNote()` inside `cls.init()`.

- **Clear the four tables, their entity changes and the four Becca maps** before each test, as
  above. An erasure is an entity change, so a table emptied without its entity changes still
  turns a raise of the same `id` and `raisedAt` into `erased`.
- **Stop the service after each test.** `getNotificationService()` is one object for the whole
  file: its budgets, its queue of built-in raises, its alerts and its transient notifications
  outlive a test until `stop()` clears them.
- **Fake the clock.** Budgets, the default `raisedAt`, the 10-minute window of alerts and the ages
  of the history read `Date.now()`. An alert goes out from a `setTimeout(0)` after the write:
  advance the timers before you assert on the `notification-alert` message.
- **Wrap every call in `cls.init()`.** A write outside a CLS context throws.
- **Create the note** that `noteId` names. A note that the test database lacks makes the
  notification sensitive, and its text disappears without a protected session.
- **Assert codes**, never messages: catch the error and compare `e.code`, as the `codeOf()` helper
  of `service.spec.ts` does.
- **A protected session**: `protectedSessionService.setDataKey(key)` with a 16-byte
  `Uint8Array`, and `protectedSessionService.resetDataKey()` in `afterEach`.
- **A category turned off**: `optionService.setOption("notificationDisabledCategories",
  JSON.stringify([ "reminder" ]))` inside `cls.init()`.
- **To test the service's rules on their own**, build a private one, as `makeService()` in
  `service.spec.ts` does: `new NotificationService({ store, transport, settings,
  getLastSyncedBatchTime })` with a transport that records its messages and a `settings` whose
  `isCategoryOff()` the test controls.
- Format a `raisedAt` with `formatUtcDateTime(ms)` of `model.ts`.

## Core: channels

`forwarder.spec.ts` shows the whole set-up; in short:

- `clearChannelTypes()` and `registerChannelType(SPEC_TYPE)`, a type whose `send()` records its
  requests and whose `getAddressState()` returns
  `{ configurationId: "conf1", templateHash: hashTemplate(undefined), changedAt }`.
- `optionService.setOption("syncServerHost", "")`, so that the instance forwards.
- `new NotificationForwarder({ record: new DeliveryRecord(port, getEntityChangeMark), transport,
  notices, getLastSyncedBatchTime })`, with `MemoryRecordPort` (or a subclass that can fail its
  reads and writes) and a transport that records messages and counts clients; then
  `await forwarder.start()`. Return `0` from `getLastSyncedBatchTime` so that nothing waits for
  sync to settle.
- Clear `notification_deliveries` with the four tables: the ledger is a table of its own.
- For a built-in channel, write its `channel` record first, with `writeDefinition(channelId, { v:
  1, type, title, config: {}, configurationId: "conf1" })`, so that its `configurationId` matches
  the type's address state.
- Enable a channel through `forwarder.switchOn(channelId, (activationId, sequence) =>
  writeActivation(…))`, with the revision of `getBuiltInRevision(definition)` for a built-in
  channel, or for a script one the `revision` that `getCurrentRevision()` gives for the channel of
  `getChannel(noteId)`, both of which can be `null` (`enable()` and `enableScript()` in the
  spec).
- A script channel is a code note with `note.setLabel("notificationChannel")`; backend scripting
  follows `config.Security.backendScriptingEnabled`, which a test sets and puts back.
- Raise with `attentionLevel: "high"`, then advance the fake clock past the grace time, and past
  1, 5 and 30 minutes for retries. Read the outcome from the `notification_deliveries` table
  (`status`, `reason`).
- Stop both the forwarder and the service in `afterEach`.

## Client

- Mock `./ws.js` with `subscribeToMessages`, `subscribeToReconnect`,
  `waitForMaxKnownEntityChangeId` and `logError`, as `notifications.spec.ts` does, and mock the lazy
  modules by path (`./notification_alerts.js`, `./notification_channels.js`).
- Answer the pages of `GET notifications` through a spy on `server.getWithSilentErrors`, and build
  notifications with a helper like `makeNotification()` of that spec: a `notificationId` of 12
  characters and the time in nine digits of base 36, a `raisedAt` with a space.
- A refusal of the backend reaches the store as the body `{ code }`; `getErrorCode()` reads it, and
  the API throws `NotificationRequestError`.
- A handler: register it with `notificationStore.registerActionHandler()`, call
  `runNotificationAction(notification, action)` of `notification_display.ts`, and assert the
  store's `update()` or `dismiss()` calls.
- The channels card and its dialogs: the fixtures of `apps/client/src/test/notification_channels.ts`.

## Scripts and channel scripts

A user script is not tested by a spec. For a backend channel script, _Send test notification_
(`POST /api/notification-channels/:channelId/test`) runs it once with a made-up payload and answers
`{ code, diagnostic? }`, with the message of a thrown error as `diagnostic`; it needs the channel
enabled and unchanged. A frontend channel has no test send. Per `CLAUDE.md`, the user exercises the
running app; a spec covers the code that the change touched.

## Traps

- A raise without `title`, `noteId`, `link`, private text or `sensitive: true` is
  `invalid-input`: spec helpers add a `title` by default.
- Over 30 raises of one producer within one fake minute is `budget` for a script or a client, and
  queued for a built-in producer.
- A standard raise beyond the 200th erases the oldest read one, then seen, then pending: a test
  that raises many reads back fewer.
- The client store follows messages and entity changes only after `start()`, which
  `app_startup.ts` calls in the app and a spec calls itself; `whenLoaded()` starts a load if none
  ran.
- Server specs run one file at a time against a shared database; the standalone runner resolves
  dependencies through their browser builds. A spec that passes on one runner can fail on the
  other.
