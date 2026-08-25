---
name: working-with-translations
description: Use when adding, finding, changing, reading or auditing a UI string in Trilium — "is there already a key for X?", "add a translation key", "what does <key> say?", "what does this button say in German?", "has this string been translated yet?", "which catalogue does this go in?", "any unused or misspelled keys?". Covers the three English catalogues (client / entry / server) and the routing rule that decides which one a key belongs to, and includes i18n.mjs to look a key up across all 39 locales, so neither the 226 KB catalogue nor a locale file ever has to be read or hand-edited. Writes English only. For deliberately filling in a lagging locale (Romanian is behind, bring a locale to 100%), use the translating-locales skill instead.
---

# Working with Trilium's English UI strings

Trilium's UI is localized with **i18next**. English is the source of truth and the only catalogue you edit by hand — the other ~38 locales belong to Weblate. This skill is the everyday case: you are building or changing a feature and need to add a string, find one that already exists, or check that nothing dangles.

Every mechanical step is [i18n.mjs](i18n.mjs).

```bash
S=.claude/skills/working-with-translations/i18n.mjs
node $S find "Cancel"                        # English text → catalogue + dotted key
node $S find totp_enroll --key               # search key paths instead of values
node $S show about.channel                   # dump one section
node $S show delete_note.delete_note --locales   # what the string says in every language
node $S add client dialog.my_thing "My text" # insert, preserving key order + formatting
node $S callers about.channel.nightly        # where a key is referenced
node $S missing                              # keys used in code but absent from the catalogue
node $S unused                               # catalogue keys nothing references
```

**Never read a whole catalogue to answer a question.** `apps/client/src/translations/en/translation.json` is 226 KB / 4032 lines / 3384 keys across 304 top-level sections — reading it costs more than any question it answers. `find` and `show` exist so nothing has to.

**Never hand-edit the JSON either.** `add` writes through the file's own indent (2), EOL (LF) and trailing newline, and appends into the correct parent object. A round-trip is byte-identical, so a one-string change is a 3-line diff. A hand-edit gets the nesting or the trailing comma wrong; a naive `JSON.parse → stringify` at the wrong indent rewrites all 4032 lines.

## Reading a string in other languages

`show <key> --locales` prints the value in every locale that has it, then the locales that don't
and the ones whose value is byte-identical to English:

```
--- client: delete_note.delete_note
  en      "Delete note"
  de      "Notiz löschen"
  ro      "Șterge notița"
  …
  22/39 locales translated
  missing: az, bg, ca, el, en-GB, fa, fi, hr, hu, md, mr, nb-NO, nl, sl, sv, ur, vi
```

Use it to answer "what does this button say in German?", "has this been translated yet?", or
"why does the Romanian UI show that?". Identical-to-English is usually legitimate — a proper noun
(`hidden-subtree.llm-title` is "AI / LLM" nearly everywhere) or a word the language shares
(Italian `login.password` is "Password"). It works for all three catalogues.

**This tool never writes a non-English file.** `add` takes a *catalogue* (`client` / `entry` / `server`),
not a locale, so `add ro …` is rejected outright — there is no path by which it can touch a
Weblate-owned file. Editing a locale is the translating-locales skill's `merge`, and even then only
for a deliberate maintainer pass.

Changing an **English** string does not update the ~38 existing translations, which then read as
translations of text that no longer exists — `show --locales` makes that visible. Weblate flags them
for review on its next pull; you don't hand-edit them.

## Which catalogue does a key go in?

| Catalogue | File | Read by |
|---|---|---|
| `client` | `apps/client/src/translations/en/translation.json` | the browser UI — everything after login |
| `entry` | `apps/client/src/translations/en/entry.json` | **only** the setup wizard, login and password-reset pages |
| `server` | `apps/server/src/assets/translations/en/server.json` | `apps/server`, the Electron main process, `packages/trilium-core`, and the standalone worker |

Getting this wrong is the most common mistake, and `add` warns when a key's section lives in a different catalogue than the one you named.

- **`entry` exists for weight.** The three pre-login pages call `initLocale(locale, "entry")` and read ~12 KB instead of the app's 226 KB — which matters because the wizard reloads the catalogue every time the user picks a language. Put a `login.*` / `set_password.*` / `setup.*` key in `client` and the pre-login pages simply will not find it.
- **The app loads both** `client` and `entry` with `fallbackNS: "entry"`, so a call site writes `t("login.password")` without caring which file holds it. Only the *new* key has to go in the right place.
- **`server.json` is misnamed** — it is the catalogue for every runtime outside the browser UI. A `t()` call added to `trilium-core` resolves in server, desktop **and** standalone with no extra work (`apps/standalone/vite.config.mts` copies `apps/server/src/assets/**` and the worker loads it with `ns: "server"`). Don't assume a core string needs a fallback to work in the browser build.

Client code imports `t` from `../services/i18n`; server, desktop and core import it from `i18next` directly.

## Adding a string

```bash
node $S find "Save changes"                   # 1. does it already exist?
node $S add client dialog.my_thing "Save changes"
```

`add` prints two advisories worth reading:

- **Duplicate text** — every existing key carrying that exact English string. Reuse one if it means the same thing; each new key costs ~38 locales a translation. But *do* add a separate key when the same English word differs by context — a language that inflects will need both.
- **Catalogue routing** — when the key's section doesn't exist in the catalogue you named but does in another.

`add` refuses to overwrite an existing key (`--force` to override) and refuses to nest under one that is already a string.

Then use it: `t("dialog.my_thing")`. Only `en/` changes — Weblate carries the string to the other locales, and you should **not** hand-edit the other ~38 locale files.

### Pluralization

i18next pluralizes only when the translation has `_one` / `_other` keys **and** the call site passes `{ count }`. Add both forms and call `t("key", { count })`:

```bash
node $S add client space_usage.my_notes_one "{{count}} note"
node $S add client space_usage.my_notes_other "{{count}} notes"
```

There is no base key — `find --key space_usage.my_notes` shows only the suffixed pair, and that is correct. Converting an *existing* single-form English key to a plural pair removes the base key, so every other locale falls back to English until Weblate migrates them; call that out in the PR.

### Interpolation

`{{var}}` everywhere. The client turns i18next's HTML-escaping off in `initLocale()`, so `{{var}}` and
`{{- var}}` behave the same there; the server catalogue still escapes, which is why `server.json` keeps
`{{- var}}` on values carrying quotes or markup. Injection is stopped where the markup is rendered — the
confirm/info dialogs sanitize with DOMPurify — not at the `t()` call. When a string embeds **components** whose order varies by language (links, note references), use `<Trans>` from `react-i18next` rather than `t()`, so translators can reorder them.

## Auditing

`missing` is the one that catches real bugs — a `t("…")` whose key is in no catalogue renders the raw key to the user:

```bash
node $S missing        # currently 1 known hit, see below
node $S unused         # advisory only
```

`unused` is **advisory, not a delete list**. It already suppresses three legitimate patterns (plural bases, dynamic prefixes, keys travelling as bare strings), but ~27 call sites build a key from a variable with no visible prefix, and keys can also be referenced from a test fixture or a docs note. Run `callers <key>` and confirm before deleting anything.

## What the scanner does and doesn't see

`missing` / `unused` / `callers` scan `apps/client/src` (against `client` + `entry`) and `apps/server/src`, `apps/desktop/src`, `packages/trilium-core/src` (against `server`). Within those:

| Pattern | Handled |
|---|---|
| `t("some.key")`, `<Trans i18nKey="some.key">` | resolved exactly |
| `t("pdf.annotations", { count })` → `_one` / `_other` | plural bases bridged in both directions |
| ``t(`about.channel.${channel}`)`` | static prefix keeps every key under it live |
| `"security-dialog.lan-access"` passed to a helper that calls `t()` | counted as a soft reference |
| `t(labelKey)` — a bare variable | **invisible**; reported as a caveat count |

**`packages/ckeditor5` is deliberately not scanned.** Its plugins pass the English text itself to CKEditor's `t()`, so the argument is a message, not a key — scanning it would produce nothing but noise. That mechanism has its own rules (a `text-editor.ck` entry keyed by the slug of the English text) and `apps/client/src/services/i18n.spec.ts` already enforces it in **both** directions, so a missing entry and a stale one both fail. See the CKEditor section of `CLAUDE.md`; don't reimplement that check here.

## Validation

```bash
pnpm --filter client test src/services/i18n.spec.ts
```

That is the repo's only translation test: valid JSON, no duplicate keys, plus the CKEditor message-catalogue check. There is **no** locale-parity test and **no** typed i18next, so a missing key fails at runtime as a raw key on screen, not at build time — which is exactly why `missing` is worth running before you finish.

## Known outstanding issue

`packages/trilium-core/src/services/hidden_subtree_launcherbar.ts:136` calls `t("hidden-subtree.llm-chat-title")`, which does not exist in `server.json` (the nearby keys are `llm-title`, `llm-chat-history-title`, `sidebar-chat-title`). Low impact — that launcher entry is `enforceDeleted: true`, so the note is removed rather than displayed. Fix it or delete the dead entry if you are in that file anyway.

## Related

- **translating-locales** — filling in a lagging non-English locale: measuring coverage, exporting work lists, placeholder validation, plural categories per locale, and how Weblate sync works. Use that skill, not this one, when the task is "bring `<locale>` to 100%".
