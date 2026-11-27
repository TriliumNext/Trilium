# Stored notifications: fields, IDs and their life

A stored notification is a row of the `notifications` table that syncs to every device. The
checks are in `packages/trilium-core/src/services/notifications/model.ts`; the rules of a raise,
an update and a dismissal in `service.ts` and `store.ts` beside it.

## Fields and their checks

`checkInput()` checks a raise. The first check that fails throws its code, before anything is
written. An empty text field (`title`, `description`, `protectedTitle`, `protectedDescription`,
`progressLabel`) counts as absent; an empty `id`, `tag`, `handler`, `icon`, `noteId`, `link` or
`raisedAt` is refused as `invalid-input`. An empty action caption is allowed.

| Field | Check | Notes |
| --- | --- | --- |
| `id` | a token: `[A-Za-z0-9_.:-]`, 1 to 100 characters | 16 random characters when absent; plain text on every device |
| `title` | one line: no control character, so no tab and no line feed | required unless `noteId`, `link`, private text or `sensitive: true` is given |
| `description` | line feeds allowed; no other control character, so no tab and no `\r` | |
| `icon` | `[A-Za-z0-9 _-]`, 1 to 100 characters, such as `bx bx-calendar` | default: the icon of the category |
| `noteId` | the charset of an entity ID: `[A-Za-z0-9_]`, 4 to 128 characters | its existence is not checked |
| `link` | `#`, a note path of entity IDs, then only the parameters below | with `noteId`, the last note of the path must be `noteId` |
| `tag` | a token | several notifications can share a tag |
| `category` | `general` (default), `reminder`, `softwareUpdate` | |
| `type` | `standard` (default), `persistent` | |
| `attentionLevel` | `low`, `medium` (default), `high` | |
| `progress` | a finite number, at most 1 | a negative number shows an indeterminate bar |
| `progressLabel` | one line | |
| `actions` | at most 5, each `{ id: token, caption: one line, icon?: icon }` | shown only with a registered handler |
| `handler` | a token | the name of the handler of the actions |
| `raisedAt` | `YYYY-MM-DD HH:mm:ss.SSSZ`, a date that exists, at most an hour ahead | default: see below |
| `sensitive` | a boolean | only `true` means something |
| `protectedTitle`, `protectedDescription` | as `title` and `description` | [sensitive-notifications.md](sensitive-notifications.md) |

**Sizes.** The content (`title`, `description`, `icon`, `link`, `progress`, `progressLabel`,
`actions`, `handler`) holds at most 8 KiB as JSON in UTF-8, and the private text at most 8 KiB as
plain JSON. Beyond that: `too-large`.

**Link parameters.** `ntxId`, `hoistedNoteId`, `viewMode`, `attachmentId`, `block`, `column`,
`columnTitle`, `columnIcon`, `columnColor`, `card`, `page`, `annotation`, `heading`,
`searchTerms`, `splits` and `activeSplit`, each with a value in the charset of
`encodeURIComponent()` plus `:`. These are what the client's `calculateHash()` writes, so
`#root/abc123?block=xyz` passes, while an unknown parameter or an unencoded space makes the link
`invalid-input`. The link's note can be `_hidden` and the like:
`#root/_hidden/_options/_optionsPassword` passes.

**Plain text.** Cards and toasts never render HTML, and show bidirectional control characters as
their code points, such as `[U+202E]`.

**What a reader gets** (`TriliumNotification`) adds `notificationId` (the key of the generation),
`raisedAt`, `updatedAt`, `revision`, `state`, `producer`, and `sensitive: true` for a sensitive
one. `revision` is opaque: it changes with the stored row and its private text, never with a
mark.

## Generations

A raise of an `id` at a `raisedAt` is a **generation**. Its `notificationId` is a hash of the `id`
followed by the time. For each `id`, the view shows the newest generation that is neither
dismissed nor dated more than an hour ahead, and a new generation erases the older ones of its
`id`.

**Without `raisedAt`** a raise is dated now, or one millisecond after the newest generation of the
`id` that the instance knows, stored or dismissed. Such a raise is therefore always new.

The outcome of a raise (`classifyRaise()`):

| Outcome | When | `create()` gives |
| --- | --- | --- |
| new | nothing at or after `raisedAt` is stored or dismissed for the `id` | the new notification |
| stored | a generation of the same `id` and `raisedAt` is stored | the stored one, unchanged |
| erased | that generation, or a later one, was dismissed | `null` |
| late | a later generation of the `id` is stored | `null` |
| category off | the user turned the category off | `null` |
| queued | a built-in producer over its budget of a minute | `null`, raised later |

| You want | Do |
| --- | --- |
| to change it in place, with no toast, keeping its state | `update(id, patch)` |
| to replace it with a fresh, unread one that alerts | `create()` with the same `id` and no `raisedAt` |
| one notification for an event that several devices or runs raise | the same `id` and the same `raisedAt` everywhere |
| to raise an event once, and never again after a dismissal | a stable `id`, and the event's time as `raisedAt` |
| independent notifications | no `id`, or one `id` each; group them with a `tag` |

**A second raise of a stored generation keeps the stored one.** Its new text is dropped. It can
only add sensitivity, and fill the fields of a private text that the stored one lacks. Change the
text with `update()`.

## Updating

`update(target, patch)` changes the current generation of an `id`. With a notification as
`target`, it changes it only while that notification's `revision` is still the stored one:
otherwise the script and client APIs resolve to `null`, and the core service throws
`stale-revision`.

- The patch takes `title`, `description`, `protectedTitle`, `protectedDescription`, `icon`,
  `progress`, `progressLabel`, `actions` and `sensitive`. **Any other field is ignored, not
  refused**: `{ type: "persistent" }` reports nothing and changes no field, yet the call still
  rewrites the row, with a new `updatedAt`, a sync and a draw from the budget.
- An empty string clears `title`, `description` or `progressLabel`, and `actions: []` removes the
  buttons. `icon: ""` is refused as `invalid-input`, and `progress` cannot be removed: raise again
  for either.
- The patched content must stay under 8 KiB.
- An update never alerts and never changes the state: a read notification stays read.
- An update does not ask for the category: a notification whose category was turned off later
  still changes.
- An update syncs and draws from the budget of a script or a client. For progress, use a
  transient notification.
- The update of a sensitive notification follows the rules in
  [sensitive-notifications.md](sensitive-notifications.md).

## Dismissing

- `dismiss(id)` erases the current generation, and does nothing for an `id` without one.
- `dismiss({ id, raisedAt })` erases that generation only. When the `id` was raised again in the
  meantime, the new generation stays.
- The route's reasons: `user` (_Remove_, _Clear all_) leaves persistent notifications and counts
  them in `refused`; `handler` (the API's `dismiss()`, a handler's `{ dismiss: true }`) and `force`
  (_Dismiss anyway_) erase them too.
- **A dismissal is final.** The erasure syncs, covers every older generation of the `id`, and
  turns a later raise of the same `id` and `raisedAt` into `null`.
- **Deleting a note erases the notifications about it**, by `noteId` or by the note of `link`: at
  once where the note is deleted, and after sync on the other devices.

## Reading

- `getById(id)` gives the current generation, or `null`.
- `getByTag(tag)` gives every current notification with the tag, newest first.
- `state` is `pending`, `seen` or `read`. A notification is seen once its card was in view of the
  open panel for a second, in a focused window, or once the user closed its toast. It is read
  after its dot or _Mark all as read_, after a click that opened its note or link (without a
  handler), and, for a standard notification, after a handler that returned nothing.

## Alerts: toast and sound

A raise alerts, with a toast in every window of its backend and the sound in one tab of each
browser profile, when all of these hold:

- its outcome is new: never for a stored generation or an update;
- its level is `medium` or `high`;
- it is still the current generation and pending when the alert goes out;
- its `raisedAt` is at most 10 minutes old;
- _Silent_ is off on the instance; for the sound, _Sound alerts_ is on too.

A `medium` toast closes after 10 seconds. A `high` one stays until the user closes it or the
notification is read. At most three toasts show, and a new one closes the oldest. The sound plays
at most once in two seconds. A notification that sync brings alerts once the instance has had no
batch of sync for 10 seconds, and at most two minutes after it arrived.

## History and limits

- **History.** While more than 200 standard notifications are current, the surplus is erased:
  read ones first, then seen, then pending, each oldest first. Persistent notifications and `high`
  ones younger than 24 hours are never trimmed. Trimming runs at every new raise and every hour.
- **Admission.** While the instance stores 800 notifications (1,000 for a built-in producer), a
  raise whose outcome would be new is refused as `full`, the replacement of an existing `id`
  included. Updates and dismissals still work.
- The budgets are in [producers.md](producers.md); every number with its constant is in
  [errors-and-limits.md](errors-and-limits.md).

## Dated ahead

A `raisedAt` up to an hour ahead is shown at once. Further ahead, the raise is refused as
`raised-ahead`. A synced generation dated further ahead, from a device with a fast clock, stays
hidden until it comes within the hour: then it counts as any other, the store reloads on
`notifications-due`, and it can alert.

## Edge cases

- **The reminder that comes back.** A script that raises `id: "remind:<noteId>"` without
  `raisedAt` at every run brings the reminder back after each dismissal. Pass the due time as
  `raisedAt`; a dismissed reminder then stays dismissed, and the next due time raises the next
  one.
- **Two devices, one event, no shared time.** Each stores its own generation, and the later one
  replaces the earlier. Each device alerts for its own, and the device that raised the earlier one
  alerts a second time when the later one syncs in, while it is pending and within 10 minutes of
  its `raisedAt`.
- **An explicit `raisedAt` older than the stored generation** is late, and gives `null`.
- **`raisedAt` from `toISOString()`** is refused: replace the `T` with a space. In core, use
  `formatUtcDateTime(ms)` of `model.ts`.
- **A raise more than 10 minutes after its `raisedAt`** is stored and shown, but alerts nobody.
  A backlog that a script raises late therefore stays silent.
- **A typo in `noteId`** is not refused: the notification becomes sensitive
  ([sensitive-notifications.md](sensitive-notifications.md)).
- **A `link` without `noteId`** opens and protects like `noteId`, but a channel's payload carries
  no `noteId` for it ([channel-scripts.md](channel-scripts.md)).
- **A notification that must survive the history** is `persistent`, or `high` for its first day.
  A standard one can be trimmed away once 200 others are current, and `getById()` then gives
  `null`.
- **Many persistent notifications** fill the admission limit, since nothing trims them: dismiss
  them from their handler.
- **A tab, a carriage return or a C1 control character in the text** makes the whole raise
  `invalid-input`. Clean text that comes from notes or from the network before passing it.
