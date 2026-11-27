# Built-in channel types: adding one in code

A built-in channel type is code of Trilium that the user creates channels of in the channels
card, as the webhook is. Script channels need no code change
([channel-scripts.md](channel-scripts.md)); add a type when a destination needs what a script
cannot have: credentials kept out of the database, a network policy, a dialog of its own.

The reference implementation is the webhook:

| Piece | File |
| --- | --- |
| The contract | `packages/trilium-core/src/services/notifications/channels/types.ts` |
| The registry | `packages/trilium-core/src/services/notifications/channels/registry.ts` |
| The type | `apps/server/src/services/notifications/webhook.ts` |
| Its credentials file and loader | `apps/server/src/services/notifications/notification_secrets.ts` |
| The route of its credentials | `apps/server/src/routes/api/notification_secrets.ts` |
| Its body template | `packages/trilium-core/src/services/notifications/channels/body_template.ts` |
| Its dialog | `apps/client/src/widgets/type_widgets/options/notification_channels/WebhookDialog.tsx` |
| The card | `apps/client/src/widgets/type_widgets/options/notification_channels/ChannelsCard.tsx` |

## The contract

```ts
export interface NotificationChannelType {
    readonly type: string;
    readonly title: string;
    readonly icon: string;
    isAvailable(): boolean;
    checkConfig(config: unknown): NotificationChannelConfig;
    getAddressState(channelId: string): ChannelAddressState | null;
    send(request: ChannelSendRequest): Promise<void>;
}
```

- **`type`**: a token, stored in each channel's `channel` record. Never rename it: the records of
  existing channels keep the old name, and a type that this runtime lacks makes them fail with
  `policy`.
- **`title`**: the list route reads `notifications.channel-type-<type>` of the server catalogue
  first, with `title` as the default; a getter over `t()` works too (the webhook's does).
- **`icon`**: a class such as `bx bx-link-external`.
- **`isAvailable()`**: `false` where the runtime cannot keep the type's policy. Creating or
  enabling an unavailable type is refused as `type-unavailable`; its deliveries fail with `policy`.
- **`checkConfig(config)`**: checks the part of the configuration that is **not** secret and
  returns it as it is stored. The create route passes `config ?? {}`, the edit route the new
  `config` when one is given. Throw `NotificationError("invalid-input")` (or `invalid-template`,
  `too-large`). `NotificationChannelConfig` holds `template?` today: a field of a new type is added
  to it in `packages/commons/src/lib/notification_channels.ts` and to `parseDefinition()` in
  `model.ts`, which drops every field it does not know when it reads a record.
- **`getAddressState(channelId)`**: what this instance holds of the channel's destination, or
  `null` when nothing is entered here. See _Addresses_ below.
- **`send(request)`**: one attempt. See _Sending_ below.

## Registration

Register the type before the forwarder starts. `start()` calls `loadChannelTypes()` once, so a
loader registered later never runs; a `registerChannelType()` call takes effect at once, but the
start has already matched the addresses of the channels that it found.

- **Code that runs everywhere** (no Node built-ins, the rules of core in `CLAUDE.md`):
  `registerChannelType(type)` from core, so the server, the desktop app and standalone all have it.
- **Node-only code**: a loader from the server, called before `buildApp()` in
  `apps/server/src/www.ts`, as `registerWebhookChannelType()` does. The loader imports the type's
  module with `import()`, so its code stays out of the startup bundle (analyzing-backend-bundle
  skill), and can load its files first:

  ```ts
  export function registerPagerChannelType() {
      registerChannelTypeLoader(async () => {
          const { pagerChannelType } = await import("./pager.js");
          return [ pagerChannelType ];
      });
  }
  ```

  The desktop app runs `www.ts` too, so it gets server types. Standalone and the mobile app do
  not: a channel of the type, synced from another device, shows there with the
  `bx bx-broadcast` icon and runs nothing. To list it as unavailable instead, register a
  placeholder in core, as `UNAVAILABLE_WEBHOOK` of `registry.ts` does, and let the server's
  registration replace it (the last registration of a `type` wins).

## Addresses and secrets

A built-in channel's `channel` record syncs, so it holds only what may be on every device:
the title and `config`. Credentials and addresses stay on the forwarding instance, in a store of
the type's own, as the webhook keeps them in its secrets file.

- `getAddressState(channelId)` returns `{ configurationId, templateHash, changedAt }`:
  - **`configurationId`**: a new random ID whenever the destination changes. The webhook makes
    one only for a new URL; a change of its headers, secret values or signing secret keeps it,
    so queued deliveries go out with the new credentials. The forwarding instance copies it into
    the `channel` record (at start, and on `notifyAddressChanged()`), each delivery records it
    when written, and an attempt whose recorded ID differs from the current one ends as skipped
    with `address`. A new destination therefore never receives what was queued for the old one.
  - **`templateHash`**: the SHA-256, in hex, of the template that the credentials were entered
    for: `hashTemplate(definition.config.template)` of `body_template.ts`. An attempt whose
    current template does not hash to it ends as skipped with `template`. **A type without a
    template returns `hashTemplate(undefined)`**, the hash of the empty string; any other value
    skips every delivery.
  - **`changedAt`**: when the address last changed, shown on the card.
- **Call `notifyAddressChanged(channelId)`** after every change of the stored address or
  credentials, on the forwarding instance. Without it, the `channel` record keeps its old
  `configurationId` until the next start: after a first address the card still says that none is
  set, and after a new one the card shows an address while every delivery ends as `address`.
- `null` means that no address is entered here: deliveries end as `address`, and the card's
  `isAddressSet` (read from the record's `configurationId`) is false.
- A route that writes credentials asks for the password, and the second factor where one is set,
  as the webhook's secret route does (`trilium-cred` and `trilium-totp` headers behind the login
  rate limiter). Never return a secret value from a route: return names and whether they are set.

## Sending

`send({ channelId, template, payload, delivery })`:

- **Read everything before the first `await`**: the address, the credentials and the
  configuration. A change after the call must not reach the request.
- Use `template` as passed: the forwarder read it once and compared its hash.
- Honour `delivery.signal`: it aborts after 30 seconds, and the attempt then counts as `timeout`.
  The channel takes no other attempt until the promise settles.
- Send `delivery.key` (the delivery key, the same for every attempt and device) so the receiver
  can drop repeats; the webhook sends it as `Idempotency-Key`.
- **Fail with `ChannelSendError(code, details)`**, never with a message of the receiver or of the
  address. `details.httpStatus` is shown on the card for `http`; `details.retryAfterMs`, from a
  `Retry-After` header, holds the channel's next attempt back by up to an hour. Any other error
  counts as `network`.
- Codes: `timeout`, `refused-destination` (a policy refused the destination), `redirect`, `http`,
  `network`, `policy` (never retried) and `secret` (credentials missing); `record` is the
  forwarder's own. A failure other than `policy` is retried after 1, 5 and 30 minutes.
- **Declare `send()` `async`**, as the webhook does. A synchronous throw escapes the handling of
  failures: it is logged as `Notification channel task attempt failed: internal.`, counts as no
  failed attempt, so no retry delay applies, and the delivery stays due.
- Over HTTP, use `safeFetch()` of `apps/server/src/services/safe_fetch.ts` with a policy, as the
  webhook does: public HTTPS addresses, plus the private or loopback ranges that the user allowed
  for that channel while the host's `allowLocalNetworkWebhooks` (in `[Notifications]`, on by
  default) lets them; plain HTTP to local addresses only; no redirects; the signal as the only
  deadline.

## The revision

A built-in channel's revision is a hash of its `type` and `config`
(`getBuiltInRevision()` of `catalog.ts`). **An edit of `config` stops the channel** until the user
enables it again; an edit of the title does not.

## The routes it uses

All in `packages/trilium-core/src/routes/api/notification_channels.ts`, generic over types:

| Route | Does |
| --- | --- |
| `POST notification-channels` `{ type, title, config? }` | creates a channel: `not-found` for an unknown type, `type-unavailable` |
| `PATCH notification-channels/:channelId` `{ title?, config? }` | edits it |
| `DELETE notification-channels/:channelId` | disables it, then deletes its record |
| `GET notification-channels/:channelId/review` | what an enabling would run, with its revision |
| `POST notification-channels/:channelId/enable` | enables the reviewed revision; labels are refused for a built-in channel |
| `DELETE notification-channels/:channelId/enable` | disables it; refused only for a malformed ID (`invalid-input`) and, after the switch-off, an unknown channel (`not-found`) |
| `PATCH notification-channels/:channelId/settings` | changes the grace time or _Protected notes_ |
| `POST notification-channels/:channelId/test` | a test send, on the backend it is sent to: status 200 with a code, or 404 `not-found`, 409 `rate-limit` |

A channel title is one line of up to 200 characters, not blank.

## The client side

The card knows the webhook only: `ChannelsCard.tsx` finds `list.types` entry `webhook`, offers
_Add webhook..._ and opens `WebhookDialog`. A new type needs:

- an entry in the card's add menu, shown from its `NotificationChannelTypeView` (`isAvailable`
  false: a hint instead, as the webhook's "needs a sync server");
- a create and edit dialog (`Modal` with `portal`, the building-client-ui skill), which calls
  `createChannel()` and `editChannel()` of `apps/client/src/services/notification_channels.ts`,
  plus the type's own credential requests on the forwarding instance;
- a branch where the card opens the dialog of a built-in channel by its `type`;
- its strings in `apps/client/src/translations/en/translation.json`, and
  `notifications.channel-type-<type>` in the server catalogue (working-with-translations skill).

The enable dialog (`ChannelDialog.tsx`), the switch, the test button and the settings work for any
type unchanged.

## Documentation and changelog

A new type is user-facing: describe it on the User Guide page _Notification channels_, and add a
changelog entry (writing-documentation skill).

## Edge cases

- **A loader registered after the forwarder started** never runs, and the type stays unknown
  until a restart. Register it before `buildApp()`.
- **A device without the type** (standalone, mobile) shows the channel but never runs it; only the
  forwarding instance writes deliveries of built-in channels, so a server type works for users of
  a server.
- **A restore** pauses the forwarding instance until the user checks the channels and resumes
  ([channel-scripts.md](channel-scripts.md)), but leaves the type's own store as it is. The
  webhook sets its credentials aside on a restore (`setSecretsAside()`, called from
  `apps/server/src/services/database_restore.ts`), so a restored database never reaches an old
  address; a new type with a store of its own does the same there.
- **A type whose destination needs no address** still returns an address state with a stable
  `configurationId`; otherwise every delivery ends as `address`.
