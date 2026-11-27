# Sensitive notifications: protected notes and private text

A sensitive notification keeps its text in a **private text**, a row of its own that is sealed
under a key derived from the data key. Outside a protected session, readers see only the public
fields. The rules are in `service.ts`, `model.ts` (`makeTextPrivate()`) and `protected_text.ts`
of `packages/trilium-core/src/services/notifications/`; what a card shows is in
`getNotificationText()` of `apps/client/src/services/notification_display.ts`.

## What makes a notification sensitive

- its `noteId`, or the note of its `link`, is protected on this instance;
- its `noteId` or `link` names a note that this instance does not hold: a typo, an erased note, or
  a note that has not synced to this device yet;
- the caller passes `sensitive: true`, `protectedTitle` or `protectedDescription`;
- it was sensitive before: the `sensitive` mark is written once and syncs, so nothing makes the
  notification plain again, and `sensitive: false` means nothing;
- its note becomes protected later: `protectNote()` in a protected session, or a protection that
  sync brings, rewrites the notifications about the note.

Each instance decides by what it holds. A device that has not synced the protection or the mark
yet still shows the plain text, and drops it once it holds either.

## What stays public

Stored in plain text on every device, also for a sensitive notification: `id`, `tag`, `noteId`,
the note path of `link`, `category`, `type`, `attentionLevel`, `icon`, `progress`, `handler`, and
the `id` and `icon` of each action. **Build IDs and tags from note IDs and dates, never from a
title or from note content.**

When the caller passes no private text, the raise also drops the public copies of what could hold
user text: the parameters of `link`, `progressLabel`, and the captions of the actions, whose
buttons then show "Action 1", "Action 2" and so on.

## Two ways to raise one

| You pass | Public text | Private text |
| --- | --- | --- |
| `title` and `description` only | none: the card falls back to the note's title or a generic title such as "Reminder" | `title` and `description` |
| `protectedTitle` or `protectedDescription`, with or without `title` and `description` | every field as written, the captions and `progressLabel` included | `protectedTitle` and `protectedDescription` |

In the second form nothing is moved or dropped: never repeat the private text in `title`,
`description`, a caption or `progressLabel`.

```js
await api.notifications.create({
    id: `diary:${note.noteId}`,
    noteId: note.noteId,
    category: "reminder",
    title: "A diary entry is due",
    protectedTitle: `Write about ${note.title}`
});
```

## The protected session

- **The private text is written only while a protected session is open** on the backend that
  writes it, since its key comes from the data key. A raise without a session drops the private
  text: the notification has only its public fields, or a generic title. A later `update()` with
  the private text, inside a session, adds it.
- **It is read back only while a protected session is open** on the reader's backend. On a server,
  that session is shared by every browser connected to it.
- `getById()`, `getByTag()` and a handler's `notification` carry `protectedTitle` and
  `protectedDescription` only during a session. Their `title` is the public one, or absent.

What a card and a toast show:

| Case | Title | Description |
| --- | --- | --- |
| not sensitive | `title`, else the note's title, else the category's title | `description` |
| sensitive, private text readable | `protectedTitle`, else the note's title, else `title`, else the category's title | `protectedDescription` |
| sensitive, session open, no private text | the note's title, else `title`, else the category's title | `description` |
| sensitive, no session | `title`, else the category's title | `description`, else a hint to enter the protected session |

The note's title comes from froca when the card renders, so it is current, and for a protected
note it shows only during a session.

## Updating a sensitive notification

- **`title` and `description` in a patch go to the private text**, empty or not, while the public
  text stays as it is. Without a protected session such a patch changes neither.
- To change the public text too, pass `protectedTitle` or `protectedDescription` in the same patch:
  `title` and `description` then apply to the public text, and the captions and `progressLabel`
  of that patch stay public.
- Without private text in the patch, a new `progressLabel` is dropped and new actions lose their
  captions.
- The first update that makes a plain notification sensitive (`sensitive: true` or private text)
  takes its stored title and description out of the public text. During a session they move to
  the private text; without one they are dropped.

## Transient notifications

The same rules decide whether a transient notification is sensitive, with two differences: its
private text stays in the backend's memory, so no session is needed to set it, and clients
receive the private text only while a protected session is open. When its note is protected,
here or through sync, `protectAbout()` of `transients.ts` makes it sensitive and its text private
at once, and the next `transient-notifications` message carries the corrected view.

## Channels

A channel never receives the private text. A sensitive notification is skipped with the reason
`protected`, unless the channel's _Protected notes_ setting is `public`: then the payload carries
the public text and no `noteId`. Once an attempt went out with the public text alone, every later
attempt of that delivery does the same, and the text of a row that is not marked sensitive, as a
restored database can bring back, is left out of it ([channel-scripts.md](channel-scripts.md)).

## Edge cases

- **A note that has not synced yet.** A raise about it on a device that lacks it is sensitive, and
  its mark syncs, so the notification stays sensitive everywhere, even though the note is plain.
  Raise about a note on a device that holds it.
- **No session at the raise.** The private text is gone, not delayed. Raise a reminder about a
  protected note with a public `title` that says enough without the note's content.
- **A title in an ID or a tag.** `id: "remind:" + note.title` stores the title in plain text on
  every device. Use `note.noteId`.
- **A handler that reads `notification.title`** of a sensitive notification gets the public title,
  or nothing. Read `protectedTitle` when present, and the note through `api.getNote()`.
- **A built-in notice about a protected note** follows the same rules: a feature in core that
  raises outside a protected session loses the text of such notices.
- **The note's title on the card** is never stored: leaving `title` out for a protected note
  leaves nothing to leak and shows the right title during a session.
