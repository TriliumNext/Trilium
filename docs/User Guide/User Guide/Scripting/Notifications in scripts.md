# Notifications in scripts
Scripts can raise notifications in the bell, give them buttons and show the progress of their work. Frontend and backend scripts both raise notifications through `api.notifications`. The functions that run when a button is pressed, called handlers, live in frontend scripts only.

The tutorial below builds one small example in four steps. The sections after it cover the details. Every method and field is also listed in the <a class="reference-link" href="Script%20API/Frontend%20API.md">Frontend API</a> and the <a class="reference-link" href="Script%20API/Backend%20API.md">Backend API</a>.

## Tutorial

Each step runs in a <a class="reference-link" href="../Note%20Types/Code.md">Code</a> note of the type _JavaScript (Trilium frontend)_: paste the code and press the <span class="tn-icon bx bx-play"></span> _Execute script_ button. Keep the _General_ notification category turned on while you try them, since a notification of a category that is off is dropped.

### Step 1: Create a notification

```javascript
await api.notifications.create({
    title: "My first notification",
    description: "Raised by a frontend script."
});
```

The bell counts the notification as new. Open the bell to find it at the top of the list, marked as coming from a frontend script. Unless _Silent_ is on, a toast shows it too.

### Step 2: Point to a note and add buttons

Replace the script with this one, but don't run it yet:

```javascript
const today = await api.getTodayNote();

await api.notifications.create({
    id: `guide:journal:${today.noteId}`,
    title: "Time to write in your journal",
    noteId: today.noteId,
    type: "persistent",
    handler: "guide:journal",
    actions: [
        { id: "write", caption: "Write now", icon: "bx bx-pencil" },
        { id: "skip", caption: "Skip today", icon: "bx bx-x" }
    ]
});
```

*   `noteId` makes the notification about today's journal note.
*   `actions` are the buttons, up to five. `handler` names the function that runs them, which step 3 registers. Until a handler with that name is registered, the buttons stay hidden.
*   `type: "persistent"` keeps the notification until its handler removes it. _Clear all_ leaves it in the list.
*   `id` makes a second run replace this notification instead of adding another one.

### Step 3: Handle the notification and its buttons

Create a second frontend Code note, paste this handler and execute it. Then run the script from step 2.

```javascript
api.notifications.registerActionHandler("guide:journal", async ({ action, notification }) => {
    // A click on the notification itself, or on its toast.
    if (action === null) {
        await api.activateNote(notification.noteId);
        return;
    }

    if (action.id === "write") {
        await api.activateNote(notification.noteId);
        // Change the description and the buttons.
        return {
            update: {
                description: "Press Done when you've finished.",
                actions: [ { id: "done", caption: "Done", icon: "bx bx-check" } ]
            }
        };
    }

    if (action.id === "done" || action.id === "skip") {
        // Remove the notification.
        return { dismiss: true };
    }
});
```

The notification now shows _Write now_ and _Skip today_. Clicking the notification opens today's note. _Write now_ opens it too and replaces the buttons with _Done_. _Done_ and _Skip today_ remove the notification.

The handler receives an object with two fields:

*   `action` is the button that was pressed, with its `id`, or `null` for a click on the notification itself.
*   `notification` is the notification, with all its fields.

Once a handler is registered, a click on the notification no longer opens its note by itself: the handler decides, as the `action === null` branch shows. What the handler returns decides what happens to the notification:

| Return value | Effect |
| --- | --- |
| Nothing | A standard notification is marked as read. A persistent one stays as it is. |
| `{ dismiss: true }` | The notification is removed. |
| `{ update: { … } }` | The notification changes. The object takes the same fields as `update()`. |

A handler works only in the window where its script ran, and only until Trilium reloads. To register it in every window at every start, add the labels `#run=frontendStartup` and `#run=mobileStartup` to the handler's note (see <a class="reference-link" href="Frontend%20Basics/Frontend%20Events.md">Frontend Events</a>).

### Step 4: Show progress while work runs

Run this in a frontend Code note, and open the bell while it runs:

```javascript
const progress = api.notifications.createTransientNotification({
    title: "Preparing the journal summary",
    progress: 0
});

try {
    for (let step = 1; step <= 4; step++) {
        // Replace this delay with one step of your work.
        await new Promise((resolve) => setTimeout(resolve, 750));
        progress.setProgress(step / 4);
        progress.setProgressLabel(`${step} of 4`);
    }
} finally {
    progress.dismiss();
}
```

A card with a progress bar appears at the top of the list, and a small circle spins on the bell. The card disappears after four steps, and no toast shows.

This is a transient notification: it shows an operation while it runs, and it is never stored or synced. `createTransientNotification()` returns its handle at once, without `await`. Call `dismiss()` in `finally`, so that the card goes away even when the work fails.

## The fields of a notification

| Field | Description |
| --- | --- |
| `title` | The title. It can be left out when `noteId` is set: the title of the note shows instead. |
| `description` | A longer text under the title. |
| `icon` | An icon class, such as `bx bx-calendar`. By default, the icon of the category. |
| `noteId` | The note the notification is about. A click opens it. |
| `link` | A place inside a note, as an internal link such as `#root/abc123?block=xyz`. Use it instead of `noteId`. |
| `attentionLevel` | `low`, `medium` (the default) or `high`. |
| `category` | `general` (the default), `reminder` or `softwareUpdate`. The user can turn off each category. |
| `type` | `standard` (the default) or `persistent`, which stays until its handler removes it. |
| `actions` | Up to five buttons, each with an `id`, a `caption` and an optional `icon`. |
| `handler` | The name of the handler that runs the buttons. |
| `id` | Your own ID for the notification, to change or remove it later. |
| `tag` | A name shared by a group of notifications, to find them with `getByTag()`. |

All texts are plain text: HTML is shown as written, not rendered.

The attention level decides how loud a notification is:

*   `low`: it only counts on the bell.
*   `medium`: a toast for 10 seconds, and a sound.
*   `high`: a toast with no timer, which closes when the user closes it or reads the notification, a sound, and the enabled <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notifications/Notification%20channels.md">Notification channels</a> forward it.

The user's settings come first: _Silent_ pauses toasts and sounds, and _Sound alerts_ turns the sound off. Generally, keep `high` for what really needs attention, since it can reach the user's phone.

## Updating and removing notifications

Give a notification an `id` to work with it later. An ID can use letters, digits and `_ . : -`, up to 100 characters. Then choose what fits:

*   To change a notification in place, call `update()` with its ID. Nothing else changes: no new toast shows, and a read notification stays read.
*   To replace it with a fresh one, call `create()` again with the same `id` and no `raisedAt`. The new notification is unread, and it alerts like any new one.
*   To raise one event from several devices or runs, call `create()` with the same `id` and the same `raisedAt` everywhere. The first call stores the notification, and later calls return the stored one. Once the user has removed it, they return `null`. See _One event on several devices_ below.
*   To remove a notification, call `dismiss()` with its ID.

```javascript
await api.notifications.create({
    id: "export-status",
    title: "Export finished",
    description: "12 notes were exported."
});

// Change the description. This shows no new toast.
await api.notifications.update("export-status", { description: "14 notes were exported." });

// Remove the notification.
await api.notifications.dismiss("export-status");
```

*   `update()` changes only the fields you pass. An empty string clears a text, as in `{ description: "" }`. It resolves to `null` when no notification has that ID.
*   `getById(id)` returns the notification, or `null`.
*   `getByTag(tag)` returns every notification with that `tag`, newest first. Several notifications can share a tag.

The notifications that these methods return also tell their `state`: `pending` (new), `seen` or `read`.

## Raising notifications from a backend script

Backend scripts use the same `api.notifications`, without `registerActionHandler()` and `getActionHandler()`. A notification raised in a backend script can still have buttons: a frontend script registers their handler, as in step 3.

Backend scripts can't use `await` at the top level. Call the methods without it: each call takes effect at once.

```javascript
const count = api.searchForNotes("#todo").length;

api.notifications.create({
    title: `${count} notes still have a #todo label`,
    attentionLevel: "low"
});
```

In the list, the notification links to the script note that raised it. Backend scripts are disabled by default; see <a class="reference-link" href="Security.md">Security</a>.

## More about buttons and handlers

*   Register the handler in every window where the buttons should work. Where no handler is registered, the buttons are hidden, and a persistent notification offers _Dismiss anyway_ instead.
*   Name the handler after your script, as in `guide:journal`. Names use the same characters as IDs, and names that start with `trilium:` are reserved for Trilium.
*   If the handler throws an error, the notification stays as it was, a toast says that the action failed, and the error is in the browser console.
*   If the notification changed while the handler ran, for example on another device, a returned update is dropped. A returned dismissal removes only the notification the handler received, not one raised again in the meantime.

## Manipulating notes

A handler often works on the note that the notification is about: it marks a task as done, or removes the label that made a script raise the reminder. `notification.noteId` holds the ID of that note.

A frontend script sets and removes the attributes of a note with `api.setLabel()`, `api.removeLabel()`, `api.setRelation()` and `api.removeRelation()`. Each takes the ID of the note first, and none of them needs backend scripting.

This example reminds you of the notes labeled `#remind`, such as tasks. First, register the handler: put it in a frontend Code note with the labels `#run=frontendStartup` and `#run=mobileStartup`, and execute it once.

```javascript
api.notifications.registerActionHandler("guide:task", async ({ action, notification }) => {
    const { noteId } = notification;

    // A click on the notification itself, or on its toast.
    if (action === null) {
        await api.activateNote(noteId);
        return;
    }

    if (action.id === "start") {
        await api.setLabel(noteId, "status", "In progress");
        return {
            update: {
                description: "In progress.",
                actions: [ { id: "done", caption: "Done", icon: "bx bx-check" } ]
            }
        };
    }

    if (action.id === "done") {
        await api.setLabel(noteId, "status", "Done");
        await api.removeLabel(noteId, "remind");
        return { dismiss: true };
    }
});
```

Then add a `#remind` label to a test note, keep the _Reminders_ notification category turned on, and raise the reminders from another frontend Code note:

```javascript
// Keep only the notes that own #remind: removeLabel() can't remove an inherited one.
const tasks = (await api.searchForNotes("#remind"))
    .filter((task) => task.hasOwnedLabel("remind"));

for (const task of tasks) {
    await api.notifications.create({
        id: `guide:task:${task.noteId}`,
        noteId: task.noteId,
        description: `Status: ${task.getLabelValue("status") ?? "not started"}.`,
        category: "reminder",
        type: "persistent",
        handler: "guide:task",
        actions: [
            { id: "start", caption: "Start", icon: "bx bx-play" },
            { id: "done", caption: "Done", icon: "bx bx-check" }
        ]
    });
}
```

Each notification shows the title of its task, since it has no `title` of its own. _Start_ sets the `#status` label of the task to _In progress_, and leaves only _Done_ on the notification. _Done_ sets `#status` to _Done_, removes `#remind` so that the next run doesn't remind you of the task again, and removes the notification. If the task is a card on a <a class="reference-link" href="../Collections/Kanban%20Board.md">Kanban Board</a> that groups its cards by _Status_, as boards do by default, and has _In progress_ and _Done_ columns, the card moves to that column.

Good to know:

*   `api.setLabel()` sets the value of the label that the note owns, or adds the label when the note owns none. `api.removeLabel()` removes the labels of that name that the note owns, or only the ones with the value you pass. Inherited labels stay as they are.
*   `api.setRelation(noteId, name, targetNoteId)` and `api.removeRelation()` do the same for relations.
*   Give names without `#` or `~`: `api.setLabel(noteId, "status")`, not `"#status"`.
*   Each call resolves once the change has reached the frontend, so a note that `api.getNote()` returns afterwards shows it. The notes that `api.getNote()` and `api.searchForNotes()` give can be read, as `task.getLabelValue("status")` does, and are changed only through these methods.
*   If a call fails, the handler fails: the notification stays as it was, and a toast says that the action failed. Each attribute change is saved separately, so if a later change fails, the earlier ones stay saved.

## More about progress

*   `progress` goes from `0` to `1`. A negative value, such as `-1`, shows a moving bar for work of unknown length. Without `progress`, no bar shows.
*   The handle has a setter for each field: `setTitle()`, `setDescription()`, `setIcon()`, `setProgress()`, `setProgressLabel()` and `setActions()`. An empty string clears a text.
*   You can call the setters as often as you need. Trilium groups the changes and sends a few updates a second at most.
*   A transient notification shows in every window connected to the same server or desktop app as the script, and nowhere else.
*   It ends when the script calls `dismiss()`. If a frontend script's window closes first, it ends about a minute later. A backend script's ends when the server or the desktop app restarts.

### A Cancel button

A transient notification can have buttons too. Its handler can sit in the same script, since the notification lives only while the script runs. The script below works even when it runs several times at once. One handler serves all the runs of a window, and finds the run to stop by the ID of the notification. Its name is unique to the window: other windows connected to the same server show the progress card too, but the Cancel button appears only in the window that started the run.

```javascript
// The handler name of this window, and the cancel functions of its runs in progress, by
// notification ID. Both are kept on `window`, so that every run in this window shares them.
const { handler, cancels } = window.guideProgressDemo ??= {
    handler: `guide:progress:${api.randomString(12)}`,
    cancels: new Map()
};
api.notifications.registerActionHandler(handler, ({ action, notification }) => {
    if (action?.id === "cancel") {
        cancels.get(notification.id)?.();
    }
});

const progress = api.notifications.createTransientNotification({
    title: "Preparing the journal summary",
    progress: 0,
    actions: [ { id: "cancel", caption: "Cancel", icon: "bx bx-x" } ],
    handler
});

let isCancelled = false;
cancels.set(progress.id, () => {
    isCancelled = true;
});

try {
    for (let step = 1; step <= 4 && !isCancelled; step++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        progress.setProgress(step / 4);
    }
} finally {
    cancels.delete(progress.id);
    progress.dismiss();
}
```

For a transient notification, the handler receives a `notification` whose `type` is `"transient"`. A returned `{ dismiss: true }` or `{ update: … }` works only in the window that created the notification.

### Progress from a backend script

A backend script runs synchronously, and the list receives the changes only once that run has finished. A notification that is created and dismissed in the same run therefore never shows. In a backend script, a transient notification is for work that goes on after the run, such as a request made with `fetch()`:

```javascript
// Replace the URL with the address of the data you need.
const url = "https://example.com/data.json";

const progress = api.notifications.createTransientNotification({
    title: "Downloading data",
    progress: -1
});

fetch(url)
    .then((response) => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    })
    .then((data) => api.log(`Downloaded ${Object.keys(data).length} entries.`))
    .catch((e) => api.log(`The download failed: ${e.message}`))
    .finally(() => progress.dismiss());
```

In a backend script, `createTransientNotification()` and the setters throw an error when Trilium refuses a change, for example `transient-limit` when too many transient notifications are shown.

## One event on several devices

A scheduled backend script, such as one with `#run=daily`, runs on each of your devices, and each run raises its own notification. To get a single notification, run the script on one device only, with the `#runOnInstance` label (see <a class="reference-link" href="Backend%20scripts/Backend%20Events.md">Backend Events</a>).

When devices raise the same event by design, give it the same `id` and the same `raisedAt` everywhere: Trilium then shows one notification. `raisedAt` is when the event happened, in UTC, written as `YYYY-MM-DD HH:mm:ss.SSSZ`, and at most an hour in the future. Do note that a notification raised more than 10 minutes after its `raisedAt` shows no toast.

## Notifications about protected notes

A notification about a protected note is _sensitive_: its text is encrypted and shows only while the protected session is open. Outside the session, the notification shows a general title, such as _Reminder_.

*   By default, `title` and `description` become the private text. The captions of the buttons, `progressLabel` and the parameters of `link` are left out, so the buttons show _Action 1_, _Action 2_ and so on.
*   To show a public text as well, pass the private text as `protectedTitle` and `protectedDescription`. The other fields, `title` and `description` among them, then stay public as written, so don't repeat the private text in them.
*   The private text is saved only if a protected session is open when the notification is raised. Otherwise, it is dropped.
*   `sensitive: true` makes any notification sensitive, and a sensitive notification stays so.
*   `id`, `tag` and `link` are stored in plain text, on every device. Build them from note IDs and dates, and keep private information out of them.

See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md">Protected Notes</a> for the protected session.

## Limits and errors

*   A backend script can raise or update 30 notifications a minute, and 500 a day. All frontend scripts share one such budget. When a script reaches its daily limit, the list says so.
*   A notification can hold up to 8 KiB of text and actions.
*   A server or a desktop app shows up to 20 transient notifications at once, each up to 2 KiB. Up to 10 of them can come from one backend script, or from all frontend scripts together.
*   When the user has turned off the category of a notification, `create()` resolves to `null` and nothing is stored.

`create()`, `update()` and `dismiss()` reject with an error whose message is a short code:

| Code | Meaning |
| --- | --- |
| `invalid-input` | A field has a wrong type, value or length. |
| `reserved-name` | An ID, a tag or a handler starts with `trilium:`. |
| `too-large` | The notification is larger than 8 KiB. |
| `budget`, `daily-budget` | The script raised too many notifications. |
| `full` | The device holds as many notifications as it can. |
| `raised-ahead` | `raisedAt` is more than an hour in the future. |

In a frontend script, put `try`/`catch` around the `await`. In a backend script, use `.catch()`:

```javascript
api.notifications.create({ title: "The report is ready" })
    .catch((e) => api.log(`The notification was refused: ${e.message}`));
```

## Writing a channel script

A channel script forwards high-priority notifications to a place of your choice. It is a JavaScript note with the `#notificationChannel` label, which the user enables in the settings (see <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notifications/Notification%20channels.md">Notification channels</a>).

Trilium runs the script once for each notification it forwards, with three extra fields in `api`:

| Field | Description |
| --- | --- |
| `api.notification` | The notification: `title`, `description`, `category`, `attentionLevel`, `raisedAt`, `noteId` and `key`. |
| `api.delivery` | This attempt: `key`, `attempt` (`1` for the first one) and `signal`, which aborts after 30 seconds. |
| `api.channelSettings` | The labels of the channel note, as they were when the channel was enabled. For example, `api.channelSettings.topic` for `#topic=alerts`. |

The notification is delivered when the script finishes without an error. If it throws, Trilium tries again after 1, 5 and 30 minutes. For asynchronous work, a backend script returns its promise, and a frontend script can use `await`.

This backend channel sends to ntfy, with the topic in the `#topic` label of the channel note:

```javascript
const { title, description } = api.notification;

return fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        topic: api.channelSettings.topic,
        title,
        message: description || title
    }),
    signal: api.delivery.signal
}).then((response) => {
    if (!response.ok) {
        throw new Error(`ntfy answered with HTTP ${response.status}`);
    }
});
```

Good to know:

*   Pass `api.delivery.signal` to what the script waits for. The channel takes no other notification until the script finishes.
*   `api.notification.key` is the same for every attempt to send one notification, so the receiver can use it to skip repeats.
*   Read the settings from `api.channelSettings`, not with `getLabelValue()`, which also returns inherited labels. `api.channelSettings` holds only what the user reviewed when enabling the channel.
*   A notification about a protected note arrives without `noteId` and with its public text only, and only if the user allowed it in the settings of the channel.
*   Any change to the script, or to the labels of its note, stops the channel until the user enables it again.
*   A backend channel runs only where backend scripts are enabled, on the device that forwards.

## See also

*   <a class="reference-link" href="Script%20API/Frontend%20API.md">Frontend API</a> and <a class="reference-link" href="Script%20API/Backend%20API.md">Backend API</a> for every method and field.
*   <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notifications.md">Notifications</a> for what the user sees.