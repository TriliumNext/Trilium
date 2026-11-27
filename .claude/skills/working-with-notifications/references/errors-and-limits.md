# Errors and limits

## Error codes

Every refusal of the notification code is a code: `NotificationError` in core,
`NotificationRequestError` in the client, `{ code }` in the body of a route (an unexpected
failure: 500 with `{ message: "internal" }`). **The message is the code alone**; neither carries
input or row text. The list is `NOTIFICATION_ERROR_CODES` in
`packages/commons/src/lib/notifications.ts`, and the statuses are `STATUS_OF_CODE` of
`packages/trilium-core/src/routes/api/notifications.ts`.

| Code | Status | Cause | What to do |
| --- | --- | --- | --- |
| `invalid-input` | 400 | a field has the wrong type, value, length or charset | check the field rules in [stored-notifications.md](stored-notifications.md) |
| `reserved-name` | 400 | an ID, handler or tag starts with `trilium:` and the producer is not built in | name it after the script |
| `raised-ahead` | 400 | `raisedAt` is more than an hour ahead | raise it when it is due |
| `too-large` | 400 | the content or the plain private text is over 8 KiB; a transient notification over 2 KiB; a template over 16 KiB; an activation over 32 KiB; a custom sound over 1 MiB | shorten the text |
| `budget` | 409 | the producer raised or updated 30 in a minute, or the producers that are not built in 120 together | raise less often; a transient notification for progress |
| `daily-budget` | 409 | a producer that is not built in raised or updated 500 in a day | wait; the panel names the producer |
| `full` | 409 | the instance stores 800 notifications (1,000 for built-in producers) | dismiss notifications, persistent ones first |
| `category-off` | 409 | the category is turned off | none: the API gives `null` instead |
| `stale-revision` | 409 | the stored revision is not the expected one | read again; the API gives `null` instead |
| `not-found` | 404 | the ID has no current generation | none: `update()` gives `null` instead |
| `transient-limit` | 409 | the backend holds 20 transient notifications, or the producer 10 | end the ones that are done |
| `not-owner` | 409 | a wrong token for a transient notification, or none in a `PUT` to an ID that exists (a `DELETE` without one is `invalid-input`) | use the token of its creation |
| `not-initialized` | 409 | the database has not opened yet | raise after startup |
| `rate-limit` | 409 | 10 enablings or 10 settings changes of a channel in an hour, or 5 test sends in a minute | wait |
| `not-forwarding` | 409 | a webhook address entered on an instance that does not forward | enter it on the sync server |
| `password-not-set` | 409 | a route asks for the password and none is set | set a password |
| `type-unavailable` | 409 | the type of channel does not run on this runtime | use the server or the desktop app |
| `safe-mode` | 409 | the server runs in safe mode | restart without it |
| `not-runnable` | 409 | a note of the channel's bundle has content that is not available | open the protected session, or unprotect the notes |
| `invalid-template` | 400 | a body template that is not JSON, nests deeper than 32, has a placeholder outside a string value, or one that is neither a payload field nor `secret.<name>` | fix the template |
| `unsupported-format` | 400 | an uploaded sound is not MP3, OGG or WAV | |
| `invalid-row`, `invalid-key`, `invalid-content`, `missing-row`, `erasure-refused` | 400 | a stored or synced row fails its check | a bug of the writer; the producer name must be a token |
| `internal` | 500 | anything else, such as a failed write | read the server log: `A notification route failed: internal.` with the stack frames, or `Notification task <task> failed: <code>.` for timer work |

What each surface does with them:

| Surface | `null` instead of a refusal | Other refusals |
| --- | --- | --- |
| core service | none: `create()` reports outcomes, `update()` throws `not-found` and `stale-revision` | throws `NotificationError` |
| backend script | `create()`: category off, erased, late; `update()`: `not-found`, `stale-revision` | the promise rejects |
| frontend script, client | the same | the promise rejects with `NotificationRequestError` |
| transient handle, backend | | the call throws |
| transient handle, frontend | | logged by code, never thrown |

## Delivery codes

A delivery ends as `sent`, `skipped`, `failed` or `expired`, and a waiting one is `waiting`.
`packages/commons/src/lib/notification_channels.ts` lists the codes.

Why an attempt failed (`NOTIFICATION_DELIVERY_ERROR_CODES`):

| Code | Cause |
| --- | --- |
| `timeout` | the attempt's signal aborted after 30 seconds |
| `script-error` | a channel script threw or rejected |
| `policy` | the channel may not run here: the channels are off, a backend channel's delivery is on an instance that does not forward, backend scripting is off, or the type is missing or unavailable. Never retried |
| `http` | the receiver answered with an error status, shown on the card |
| `network` | the request failed, or a built-in type threw something other than `ChannelSendError` |
| `refused-destination` | the network policy refused the address |
| `redirect` | the receiver answered with a redirect, which is not followed |
| `secret` | a credential that the request needs is not set |
| `record` | the delivery record could not be written |

Why a delivery ended without a send (`NOTIFICATION_DELIVERY_SKIP_REASONS`):

| Reason | Cause |
| --- | --- |
| `marked` | seen or read before its grace time passed |
| `erased` | dismissed, replaced, or erased with its note |
| `disabled` | the channel was disabled or deleted, or its activation is not the live one |
| `changed` | what the channel runs changed since it was enabled, or cannot run |
| `address` | a built-in channel's address changed, or none is set |
| `template` | the body template is not the one the credentials were entered for |
| `protected` | a sensitive notification, and the channel sends nothing about protected notes |
| `no-client` | no window was connected to run a frontend channel |
| `resume` | the user chose to skip what was due when forwarding resumed |

A test send answers with status 200 and `{ code }`: `sent`, one of the error codes or one of the
skip reasons. Only an unknown channel (`not-found`) and `rate-limit` come back as refusals.

## Limits

| Limit | Value | Defined in |
| --- | --- | --- |
| ID, tag, handler, action ID | `[A-Za-z0-9_.:-]`, 1 to 100 | `TOKEN` in `model.ts` |
| icon | `[A-Za-z0-9 _-]`, 1 to 100 | `ICON` in `model.ts` |
| actions | 5 | `MAX_ACTIONS` in `model.ts` |
| content, plain private text | 8 KiB each | `CONTENT_MAX_BYTES`, `PLAIN_PRIVATE_TEXT_MAX_BYTES` |
| `raisedAt` ahead of the clock | 1 hour | `AHEAD_TOLERANCE_MS` |
| toast after `raisedAt` | 10 minutes | `ALERT_WINDOW_MS` in `service.ts` |
| raises and updates of a producer | 30 a minute | `PRODUCER_MINUTE_BUDGET` |
| of all producers that are not built in | 120 a minute | `SHARED_MINUTE_BUDGET` |
| of a producer that is not built in | 500 a day | `DAILY_BUDGET` |
| stored notifications, built-in producers | 1,000 | `NOTIFICATION_LIVE_LIMIT` |
| stored notifications, scripts and clients | 800 | `NOTIFICATION_LIVE_LIMIT_FOR_OTHERS` |
| standard notifications kept | 200 | `HISTORY_LIMIT` |
| `high` notifications never trimmed | for 24 hours | `YOUNG_HIGH_MS` |
| page of `GET /api/notifications` | 200 | `NOTIFICATION_PAGE_SIZE` |
| refs in one state or dismiss request | 500 | `NOTIFICATION_MAX_REFS` |
| transient notifications of a backend, of a producer | 20, 10 | `TRANSIENT_NOTIFICATION_LIMIT`, `..._PRODUCER_LIMIT` |
| one transient notification | 2 KiB | `TRANSIENT_NOTIFICATION_MAX_BYTES` |
| a client's transient notification ends | 1 minute after its last change | `TRANSIENT_NOTIFICATION_EXPIRY_MS` |
| a client sends it again | every 20 seconds | `TRANSIENT_NOTIFICATION_REFRESH_MS` |
| delivery deadline | 23 hours after `raisedAt` | `NOTIFICATION_DELIVERY_DEADLINE_MS` |
| one attempt | 30 seconds | `ATTEMPT_TIMEOUT_MS` in `forwarder.ts` |
| retries | after 1, 5 and 30 minutes | `RETRY_DELAYS_MS` |
| `Retry-After` honoured | up to 1 hour | `RETRY_AFTER_MAX_MS` |
| first attempts of a channel | 30 an hour | `CHANNEL_BUDGET` |
| of one producer that is not built in, of all of them | 10, 20 an hour | `PRODUCER_SHARE`, `COMMON_SHARE` |
| grace time | 0 to 12 hours, 5 minutes by default | `NOTIFICATION_GRACE_TIME_MAX_SECONDS` |
| browser profiles per frontend delivery | 16 | `NOTIFICATION_FRONTEND_MAX_PROFILES` |
| labels a settings widget writes | 20, each up to 1 KiB, names `[A-Za-z0-9_]{1,64}` | `NOTIFICATION_CHANNEL_MAX_LABELS` |
| channel title | 200 characters | `TITLE_MAX_LENGTH` in `notification_channels.ts` |
| webhook body template | 16 KiB | `WEBHOOK_TEMPLATE_MAX_BYTES` |
| webhook headers, secret values | 10 each, up to 4 KiB | `WEBHOOK_MAX_HEADERS`, `WEBHOOK_MAX_VALUES`, `WEBHOOK_SECRET_MAX_BYTES` |
| custom sound | 1 MiB | `NOTIFICATION_SOUND_MAX_BYTES` |

Every budget and rate lives in memory, so a restart resets it.
