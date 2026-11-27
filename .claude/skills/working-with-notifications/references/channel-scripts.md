# Channel scripts: forwarding with a backend or a frontend script

A script channel is a code note that owns `#notificationChannel`. Once the user enables it, Trilium
runs it once for each `high` notification it forwards, with the notification in `api.notification`.
A backend channel runs on the server side of the forwarding instance; a frontend channel runs in
the open windows of every device. The rules are in
`packages/trilium-core/src/services/notifications/channels/` (`script_channels.ts`, `catalog.ts`,
`payload.ts`, `forwarder.ts`) and the client runner in `apps/client/src/services/notification_channels.ts`.

## What a channel forwards, and when

- **Only `high` notifications**, while they are current: not dismissed, not dated ahead, and less
  than 23 hours past their `raisedAt`. The notices that channels raise about themselves are
  `medium`, so they are never forwarded.
- A **delivery** is written for each such generation and each enabled channel: when the generation
  is stored or arrives by sync, when a channel is enabled, at start, and when forwarding resumes.
- It is **due at `raisedAt` plus the channel's grace time**, and waits until sync has been quiet
  for 10 seconds (at most two minutes).
- **Before every attempt** the forwarder checks again, and ends the delivery when the notification
  was dismissed (`erased`), is past the 23 hours (`expired`), when the channel lost its activation
  (`disabled`), changed (`changed`), may not run here (`policy`), when the notification was seen or
  read before the first attempt and the grace time is above zero (`marked`), and when it is
  sensitive and the channel sends nothing about protected notes (`protected`).
- After a restore, a move or a rollback of the database, **forwarding pauses** until the user
  chooses, in the channels card, to send or to skip what is due.

## Making a note a channel

1. Create a code note: _JavaScript (Trilium backend)_ (`application/javascript;env=backend`) for a
   backend channel, _JavaScript (Trilium frontend)_ or JSX (`text/jsx`) for a frontend one.
2. Give it the **owned** label `#notificationChannel`; an inherited one does not count. The
   channels card in _Options → Notifications_ lists it as _Found, not enabled_, under the note's
   title and icon.
3. Optionally, give it owned labels as settings, and a `~configWidget` relation to a settings
   widget (see below).
4. The user turns its switch on. The dialog shows the whole bundle as text, with its attributes,
   the grace time (0 to 12 hours, 5 minutes by default) and _Protected notes_ (`none` by default,
   or `public`). _Enable_ enables what was reviewed.

The **bundle** is built as for any script (`collectScriptRecord()` in `services/script.ts`): the
note and, recursively, its descendants that are scripts of the same environment, HTML notes or
file notes, except those with `#disableInclusion`. A script child is passed to its parent as a
module, under a variable named after its title with every character outside `[A-Za-z0-9_]`
dropped; an HTML child adds markup only.

## The run

| `api` field | Holds |
| --- | --- |
| `api.notification` | what the channel receives, `NotificationChannelPayload` |
| `api.delivery` | this attempt: `key`, `attempt` and `signal` |
| `api.channelSettings` | the owned labels of the channel note, as the enabling recorded them |

`api.notification`, built before each attempt from the stored row:

| Field | Value |
| --- | --- |
| `key` | the delivery key, see _Duplicates_ below |
| `title` | always text: the notification's title, else its note's title (not for a sensitive notification or a protected note), else a generic title of the category, in the language of the instance that forwards |
| `description` | absent when empty |
| `category` | `general`, `reminder` or `softwareUpdate` |
| `attentionLevel` | `high` |
| `raisedAt` | `YYYY-MM-DD HH:mm:ss.SSSZ` |
| `noteId` | the notification's `noteId`; absent for a sensitive notification, and for one with only a `link` |

An update of the notification between two attempts changes what the next one sends. The private
text is never sent; a sensitive notification carries its public text only
([sensitive-notifications.md](sensitive-notifications.md)).

`api.delivery`: `key` (as above), `attempt` (1 for the first; up to 4 for a backend channel, always
1 for a frontend one) and `signal`, which aborts after 30 seconds.

`api.channelSettings`: name to value, the first value for each name, without
`notificationChannel` and without relations. Read the settings here, not with
`api.startNote.getLabelValue()`, which also returns inherited labels and values that nobody
reviewed.

**Success and failure.**

- A backend channel **returns** the promise of its work: `return fetch(…).then(…)`. A run that
  returns nothing, or a promise that resolves, counts as sent; a throw or a rejection is a failed
  attempt. A promise that is not returned is not waited for: the delivery counts as sent at once,
  and a later failure reaches only the log and the error report of every window
  (`unhandled-error`), never the delivery.
- A frontend channel runs inside an async function: `await` its work. Finishing counts as sent, a
  throw as failed. Work that it does not await is not waited for.
- **Pass `api.delivery.signal`** to `fetch()` and to whatever else waits. At 30 seconds it aborts;
  work that then fails counts as `timeout`, and work that ignores the abort and succeeds counts as
  sent. The channel starts no other attempt until the promise settles, so a script that ignores
  the signal holds its channel; the card shows since when.
- **No message is recorded.** The status of the channel keeps the code (`script-error`, `timeout`).
  Only a test send that ends in `script-error` shows the message of the error, as its
  `diagnostic`, cut at 1,000 characters. Throw errors with messages that help the user fix the
  channel.

## Backend channels

- **Their deliveries are written only on the forwarding instance**: the one without a sync
  server, which is the sync server itself, or a desktop app or standalone instance that syncs
  nowhere. A desktop app that syncs to a server writes none: the server forwards.
- **They need backend scripting on that instance** (`backendScriptingEnabled`). Without it, each
  delivery ends as failed with `policy`, and a notice in the bell says that the channel needs
  backend scripting.
- **Safe mode, `channelsDisabled`** in the `[Notifications]` section of the configuration
  (`TRILIUM_NOTIFICATIONS_CHANNELS_DISABLED`), **and a sync server host set to `disabled`** stop
  every channel of the instance, frontend ones too: no delivery is written, one that waited from
  before the switch ends as failed with `policy` at its next check (`checkChannel()`), and a test
  send answers `policy`. A backend channel's delivery that waited from before the instance took a
  sync server ends the same way, since the server forwards it; a test send still runs there.
- **Retries**: a failure waits 1, 5 and 30 minutes before the second, third and fourth attempt; the
  fourth failure ends the delivery as failed. `policy` never retries, and a retry that would come
  after the 23 hours ends the delivery. A retry runs every check again except the one for marks:
  reading the notification no longer stops it.
- **Test send**: _Send test notification_ runs the channel once with a made-up payload: a `key`
  that starts with `test-`, a generic title, `category: "general"`, `attentionLevel: "high"`, no
  `description`, no `noteId`. It runs on the backend of the window where it is pressed, only while
  the channel is enabled and unchanged and the channels are on, also while forwarding is paused,
  at most five times a minute. It answers `sent` or a code, with the error message as `diagnostic` for `script-error`.
  Handle the missing fields, since a test has neither.

## Frontend channels

- **Every device makes their deliveries**: each backend for the windows connected to it, the
  server for its browsers and each desktop app for its own windows.
- When a delivery is due, the backend announces it to its connected windows. Each window claims it
  with the ID of its browser profile, kept in IndexedDB per database. The backend grants it once
  per profile, to at most 16 profiles, and **every granted window runs the script**. The first
  result ends the delivery; later results are ignored.
- **One notification therefore runs a frontend channel once per browser profile on each device.**
- **No window connected when it is due**: the delivery ends as skipped, `no-client`.
- **A delivery that no window claims is announced again** after 1 and 5 minutes, then every 30
  minutes, until a window claims it or the 23 hours pass; the time is in the ledger, so a restart
  keeps it. An announcement that finds no window connected ends the delivery as skipped,
  `no-client`. A window opened in the meantime can claim it.
- **No retries**: a failure ends the delivery as failed, and `api.delivery.attempt` is always 1.
  A window that closes during the run leaves the delivery open until the 23 hours, when it
  expires.
- Deliveries of a frontend channel can run at the same time: the next one is announced without
  waiting for the previous result.
- A window where IndexedDB cannot open uses the profile ID `fallback`, which every such window
  shares, so only one of them runs a delivery.
- The card offers no test send for a frontend channel; the route answers `policy`.
- The script has the frontend `api` and the page's permissions, as any frontend script: it can
  use browser APIs, and reach addresses that only the user's machine reaches, within CORS.

## Duplicates and the key

- The key is an HMAC of `<id>|<raisedAt>|<channelId>` under a key derived from `documentSecret`:
  the same for every attempt, on every device and after a restart, different for each channel,
  and it does not show the notification's ID.
- **A receiver drops repeats of a key.** A backend channel can repeat after a timeout whose
  request still arrived; a frontend channel repeats once per browser profile and device.
- An update of a notification never makes a new delivery. A new generation (a raise of the `id`
  again) makes a new delivery, with a new key.

## Settings

Owned labels of the channel note are its settings: `#url=…`, `#topic=…`.

- `api.channelSettings` holds them **as the enabling recorded them**. Changing a label stops the
  channel, and the new value reaches the script after the next enabling.
- **They sync in plain text** with the note, to every device and into every backup: a token in a
  label is wherever the database is. (Support copies blank them.) A webhook keeps its credentials
  out of the database instead; a script channel has no such store.

### The settings widget (`~configWidget`)

The channel note's own `~configWidget` relation points to a frontend note (JavaScript or JSX)
whose bundle returns a Preact component: `export default` in JSX, `module.exports =` or `return` in
JavaScript.

- The enable dialog runs it only when the user presses _Run this channel's settings widget_,
  after the review.
  The widget note and its children are part of the reviewed bundle.
- Props: `settings`, the channel note's own labels without the built-in ones
  (`BUILTIN_ATTRIBUTES`), until the widget calls `onChange`; then what it passed.
  `onChange(labels)` replaces that whole set.
- At the enabling, **each label passed is written with `setLabel()`** on the channel note, before
  the revision is taken, so the enabling covers them. Nothing is removed: pass `""` to clear a
  value.
- **Every label passed is checked**: a name of `[A-Za-z0-9_]`, 1 to 64 characters, not a built-in
  name, at most 20 labels, each value a string of at most 1 KiB. One label that fails refuses the
  whole enabling as `invalid-input`. Pass only the widget's own labels: spreading `settings` passes
  every other label of the note too, a `#my-topic` among them.
- The dialog is a form: Enter in a text box of the widget submits it, which enables the channel. A
  `Button` without `onClick` submits it too.
- Safe mode refuses the widget (`safe-mode`). An error while it renders shows as text in its place.

```jsx
import { FormGroup, FormTextBox } from "trilium:preact";

export default function ReceiverSettings({ settings, onChange }) {
    return (
        <FormGroup name="url" label="Receiver URL">
            <FormTextBox
                type="url"
                currentValue={settings.url ?? ""}
                onChange={(url) => onChange({ url })}
            />
        </FormGroup>
    );
}
```

## What stops a channel

- **Any change to the reviewed bundle**: the content, title, type, MIME type or attributes of any
  of its notes (the channel note, the descendants the bundle includes, the widget note and its
  included descendants), and an included descendant that is added or removed. **Renaming the
  channel note stops it too.** The card shows _Changed since it was enabled_, deliveries end as
  `changed`, and a notice in the bell says so, at most once an hour. _Review..._ shows the bundle
  again; when only the channel note's own attributes changed, it shows the list of those changes
  instead.
- Removing `#notificationChannel`, deleting the note, or the user disabling it.
- **A note of the bundle whose content is not available**, such as a protected note outside a
  protected session: the channel cannot run (`isNotRunnable`, the enabling is refused as
  `not-runnable`), and its deliveries end as `changed`. Keep a channel's notes unprotected.

## Budget and rates

- A channel makes at most **30 first attempts an hour**. Built-in producers go first and can use
  all 30; scripts and clients get at most 10 each and 20 together. Retries do not count.
- Deliveries over the budget wait (the card counts them as waiting) and expire after their 23
  hours.
- The routes allow 10 enablings an hour per channel, 10 changes of the settings an hour per
  activation and 5 test sends a minute per channel: beyond that, `rate-limit`.

## Grace time and marks

- With a grace time above zero, a notification that the user sees or reads in Trilium before the
  first attempt is skipped as `marked`. Zero sends at once, also what was seen or read.
- **Enabling a channel forwards the recent backlog**: every `high` notification of the last 23
  hours that is still shown gets a delivery. With a grace time above zero the seen and read ones
  end as marked and the unread ones go out, within the budget; with zero, all of them go out.
- A notification raised with an old `raisedAt` is due at once, since its grace time already
  passed, or never, when it is older than 23 hours.

## Safety

- `#notificationChannel` and `~configWidget` are dangerous attributes: Safe import renames them to
  `disabled:notificationChannel` and `disabled:configWidget`, so an imported channel is not a
  channel until the user renames them back.
- The LLM tools of the AI chat do not see channel notes, their widgets or the notes below them:
  the in-app AI can neither read nor change a channel.
- **Do not give a channel note `#run` labels or event relations.** They run it as an ordinary
  script too, where `api.notification` is `undefined`.
- **Do not raise `high` notifications from a channel script**: each one is forwarded again,
  through every channel. The budget slows such a loop; it does not stop it.

## Example: a backend channel

A _JavaScript (Trilium backend)_ note with `#notificationChannel` and `#url=https://…`:

```js
const { url } = api.channelSettings;
if (!url) {
    throw new Error("Give the channel note a #url label, then enable the channel again.");
}

const { key, title, description, category, raisedAt } = api.notification;
return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ title, message: description ?? "", category, raisedAt }),
    signal: api.delivery.signal
}).then((response) => {
    if (!response.ok) {
        throw new Error(`The receiver answered with HTTP ${response.status}.`);
    }
});
```

The receiver drops a repeated `Idempotency-Key`. Add `~configWidget` to a note with the
`ReceiverSettings` widget above to let the user enter the URL in the enable dialog.

## Example: a frontend channel

A _JavaScript (Trilium frontend)_ note with `#notificationChannel`, which shows each notification
as a system notification of the browser:

```js
if (!("Notification" in window) || Notification.permission !== "granted") {
    throw new Error("This browser does not allow system notifications for Trilium.");
}

const { key, title, description } = api.notification;
// The same tag replaces a notification of this key instead of adding a second one.
new Notification(title, { body: description ?? "", tag: key });
```

- Browsers offer `Notification` only in a secure context (HTTPS or `localhost`), and each browser
  profile grants the permission on its own. `Notification.requestPermission()` needs a click: a
  settings widget can offer a button for it.
- Some browsers, on phones in particular, refuse the constructor and throw; the delivery then
  fails in that profile.
- Here a run in every profile is what the user wants: each device shows the notification.

## Edge cases

- **A backend channel enabled on a desktop app that syncs** shows as enabled, but forwards from
  the server, which needs backend scripting itself. A test pressed on the desktop app runs the
  script there, so a passing test proves nothing about the server.
- **The status of a backend channel** (last error, counts) is written by the forwarding instance
  and syncs; a frontend channel's counts are those of the device that shows the card.
- **A child titled `my-helper.js`** reaches its parent as the variable `myhelperjs`: every
  character outside `[A-Za-z0-9_]` is dropped, non-ASCII letters included.
- **A channel that sends every notification twice** is usually a frontend channel open in two
  browser profiles or on two devices: use the key, or make it a backend channel.
- **A channel that sends nothing**: check that the notification is `high`, its category is on,
  its grace time passed without the user seeing it, the instance is not paused, and, for a
  backend channel, that this is the forwarding instance with backend scripting on.
