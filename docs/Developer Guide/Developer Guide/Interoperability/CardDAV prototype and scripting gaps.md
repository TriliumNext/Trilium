# CardDAV prototype and scripting gaps

`apps/script-deployer/scripts/carddav.ts` implements a CardDAV server as a Trilium backend
script — a NextCloud-style address book that phones and desktop clients sync against, with
**one note per contact**. It was deliberately built *entirely* inside the scripting system
(a `#customRequestHandler` note, no dedicated server routes) to find out where the scripting
system's limits are. This document records the design and every gap that surfaced.

## What the prototype does

- Serves the CardDAV subset real clients need at `/custom/carddav/`: `OPTIONS`, `PROPFIND`
  (depth 0/1), `REPORT` (`addressbook-query`, `addressbook-multiget`), `GET`, `PUT` (with
  `If-Match`/`If-None-Match` semantics), `DELETE`, plus principal/home-set discovery,
  per-contact ETags and a collection CTag.
- An address book is any note with `#carddavAddressBook`. On first use the script creates a
  "Contacts" `book` collection (table view) with inheritable promoted attribute definitions,
  so synced contacts edit nicely in the Trilium UI — `email`/`phone` promoted fields render
  mailto/tel action buttons, and `#email *=* "@acme.com"` search works immediately.
- A contact is a child note: `FN` ↔ note title, `NOTE` ↔ note content, and
  `EMAIL`/`TEL`/`ORG`/`TITLE`/`BDAY`/`URL`/`ADR`/`CATEGORIES`/`N`/`UID` map to labels
  (`#email`, `#phone`, `#organization`, `#jobTitle`, `#birthday`, `#website`, `#address`,
  `#category`, `#firstName`/`#lastName`, `#vcardUid`). Unmapped vCard properties are
  preserved in `#vcardExtra` so foreign clients' data survives a round trip (except `PHOTO`,
  whose base64 payload does not belong in an attribute).
- Authentication is HTTP Basic against the `#carddavPassword` label on the script note.

### Using it

1. Run `pnpm --filter @triliumnext/script-deployer dev` (or deploy the script note to a real
   instance) with `[Security] backendScriptingEnabled=true`.
2. Set `#carddavPassword=<password>` on the script note.
3. Point DAVx⁵ / macOS Contacts / Thunderbird at `http://<host>/custom/carddav/` with any
   username and that password. There is no `/.well-known/carddav`, so the base URL must be
   entered explicitly.

### Known behavioral limits

- vCards are emitted as version 3.0; `TYPE` parameters on `EMAIL`/`TEL` are dropped.
- `addressbook-query` filters are not evaluated (the full collection is returned; clients
  filter locally). No `sync-collection` REPORT — clients fall back to CTag polling.
- `PHOTO` is dropped, and a phone-side edit of the contact's note text replaces rich
  Trilium content with plain paragraphs (`NOTE` is plain text by definition).

## Scripting-system gaps found

Each of these blocked the prototype or forced a workaround. Fixes marked ✔ landed with the
prototype; the rest are candidate improvements.

1. **Request bodies with non-default content types never reached scripts** ✔ fixed.
   `apps/server/src/app.ts` mounted `express.text()` with its `text/plain` default, so a
   `PROPFIND` body (`application/xml`) or vCard `PUT` (`text/vcard`) left `req.body`
   `undefined` — and because backend scripts are synchronous (next item), a script cannot
   read the unconsumed stream itself. The parser now accepts `text/*`, `application/xml`
   and `application/*+xml`.

2. **Backend scripts cannot be async.** `executeBundle` wraps scripts in a synchronous
   function on purpose — the SQL transaction and CLS entity-change tracking would lose
   their scope across `await` (`packages/trilium-core/src/services/script.ts`). This rules
   out `fetch`, `crypto.subtle`, streaming request bodies, and any async-only library. A
   scoped "async custom handler" (transaction per await-segment, or an explicit opt-out of
   the transaction wrapper) would unlock a whole class of integrations.

3. **No cryptography for scripts.** `node:crypto` is on the module blocklist,
   `crypto.subtle` is unusable (async), and nothing hash- or HMAC-shaped is exposed on the
   script API. Consequences here: ETags use a hand-rolled FNV-1a hash, and password
   comparison is a best-effort constant-time loop instead of `timingSafeEqual`. Exposing a
   small `api.crypto` (hash, hmac, timing-safe compare, randomBytes) would fix this class.

4. **Scripts cannot validate ETAPI tokens.** The natural auth story for a protocol endpoint
   ("Basic auth with an ETAPI token as password", as the MCP endpoint effectively does) is
   impossible from a script: `etapi_tokens` is not exposed and the token hash cannot be
   recomputed without crypto. Hence the plaintext `#carddavPassword` label.

5. **All-or-nothing security toggle.** Running one custom handler requires
   `backendScriptingEnabled=true`, which enables *every* backend script — the toggle is
   documented as RCE-equivalent. There is no per-note or per-capability grant (e.g. "this
   note may serve requests but not require modules").

6. **No routes outside `/custom`.** A script cannot serve `/.well-known/carddav`, so
   client auto-discovery cannot work; users must type the full base URL. A declarative
   well-known → custom-handler redirect map would be enough.

7. **`ScriptBNote` typings lag the runtime entity.** Missing from the typed surface, all
   needed here and reached via casts: `save()` (rename a note), `addAttribute()` (create an
   *inheritable* label, or a second label with the same name — `setLabel()` overwrites the
   first value and cannot create inheritable ones, so multi-valued `#email` labels and
   promoted-definition provisioning both need the entity API).

8. **Module allowlist gaps.** `zlib` was neither allowed nor blocked, so the pre-existing
   sample scripts (`auto-import-xopp`, `auto-import-rnote`) failed at `require` — ✔ now
   allowed (pure computation, no OS access). There is also no vCard/iCal library available
   to scripts, hence the hand-rolled parser; `xml2js` being allowed (and synchronous) is
   what made the DAV XML side tractable.

9. **script-deployer harness rot** ✔ fixed. The fresh-database path called `cls.init()`
   before anything had initialized the core execution context (it now starts the server
   first, like the setup wizard); front-matter labels other than `run`/`execute*` were not
   deployable (`customRequestHandler` is now passed through); and the dev instance did not
   enable backend scripting, so every deployed handler answered 403 (now enabled via
   `TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true`). Nothing CI-tests this harness
   against a fresh database, which is how it rotted unnoticed.

10. **Custom handlers run outside any SQL transaction.** Mutating handlers must remember
    `api.transactional(...)` themselves; nothing documents this, and a forgotten wrapper
    means entity changes land without transactional grouping. Either document it or wrap
    handler execution the way API routes are wrapped.

## Verified end-to-end

Against the script-deployer dev instance, with curl driving the exact request shapes
DAVx⁵ uses: discovery chain (root → principal → home set → address book), address book
auto-provisioning, contact create/read/update/delete with correct `201`/`204`/`404`/`412`
codes, ETag change on update, stale `If-Match` rejection, multiget with a missing href
(per-href `404` inside the `207`), unknown-property round-trip via `#vcardExtra`, and the
Trilium-side note carrying the expected title, labels and promoted definitions.
