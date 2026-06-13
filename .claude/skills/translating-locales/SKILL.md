---
name: translating-locales
description: Use when filling in or improving a lagging UI translation locale in Trilium (e.g. "Romanian is behind", "bring <locale> to 100% coverage", "translate the missing strings"). Covers measuring the gap vs English, drafting translations that preserve i18next placeholders, merging without diff churn, locale grammar rules (Romanian plurals/gender), the source-side pluralization workflow, how Weblate sync actually works (merging is picked up), and validation.
---

# Translating / improving a locale in Trilium

Trilium's UI is localized with **i18next**. English is the source of truth; other locales are normally crowd-translated via **Hosted Weblate**. This skill is for the *maintainer* case: deliberately filling a locale that lags behind (the recurring one is Romanian, `ro`).

**Scope — this skill *fills* an already-registered locale.** To **add a brand-new locale** (e.g. Polish) you must first do the one-time registration/build wiring; that's a separate task. Follow `docs/Developer Guide/Developer Guide/Concepts/Internationalisation  Translations/Adding a new locale.md` to register it, then come back here to translate the strings.

Read [romanian.md](romanian.md) for Romanian grammar rules and [scripts.md](scripts.md) for the copy-paste Node snippets used in every step below.

## How Weblate sync works here (merging a PR IS picked up — no separate upload needed)

Weblate is linked to this repo with the **GitHub pull-request push method**: `.github/workflows/i18n.yml` triggers on `push` to `weblate:*` branches, and Weblate opens PRs into the repo (the recurring `Translations update from Hosted Weblate (#…)` PRs). The locale `translation.json` / `server.json` files are tracked Weblate **components**. Consequently:

- **Merging a PR that edits a locale file IS picked up by Weblate.** On its next pull of the default branch, Weblate imports the new/changed translations into its database — they persist and show up for other contributors. They are **not** discarded or overwritten. With the PR-based push method Weblate never force-pushes the default branch, so the repo is authoritative and Weblate merges *from* it.
- A direct-to-repo PR is therefore a fully valid, durable way to land translations. **You do NOT need to separately upload the file into Weblate.**
- This is the opposite of arbitrary repo files (README, docs): those aren't part of any Weblate component, so Weblate simply ignores them.
- Real (narrow) caveat: a true conflict only arises if the **same key** is edited simultaneously in Weblate (pending, un-pushed) *and* in the repo — then Weblate's merge/rebase conflict handling picks the winner. Filling previously-empty/untranslated strings doesn't conflict.
- `CLAUDE.md`'s "only add new keys to `en/translation.json`" rule is about where *new source strings* originate (so they enter the translation pipeline), **not** a prohibition on landing translations for an existing locale via the repo.
- Changing an **English source** string (e.g. pluralizing a key) makes Weblate flag the matching translations in *other* locales as needing review and drop orphaned removed-key entries — normal, and it doesn't affect the locale you just filled.

## File locations

| Scope | English source | Target locale |
|---|---|---|
| Client UI | `apps/client/src/translations/en/translation.json` | `apps/client/src/translations/<locale>/translation.json` |
| Server (hidden subtree titles, dialogs, migration/search messages) | `apps/server/src/assets/translations/en/server.json` | `apps/server/src/assets/translations/<locale>/server.json` |

Both client and server have their own EN↔locale pair — check **both**.

## Workflow

### 1. Measure the gap
Flatten EN and the locale, then report **missing** keys (not in locale) and **identical-to-EN** keys (present but never translated — excluding proper nouns). See `scripts.md` → *measure*. **Measure, don't assume a number** — coverage drifts as the locale fills (an active `ro`-translations worktree moves it), so run *measure* against the live files before quoting a percentage.

### 2. Export the work list
Dump `{ key: englishValue }` for every missing-or-identical string to a temp file so you can translate against the real source text. See `scripts.md` → *export*.

### 3. Draft the translations
- Match the **terminology and tone already in the file** (probe existing entries first — e.g. RO uses `notiță` for "note", `Anulează` for "Cancel"). Don't invent new terms.
- **Keep proper nouns and kept technical terms in English**: ETAPI, MCP, OAuth/OpenID, Markdown, Widget, Mermaid, Bing/Google/Gantt/Kanban/…, and words spelled the same in the target language.
- **Preserve every placeholder exactly** (this is the #1 source of bugs):
  - `{{var}}`, `{{- var}}` (unescaped — keep the hyphen), `{keyword}` (single-brace, e.g. search-engine URLs)
  - JSX/`<Trans>` tags: `<buildRevision />`, `<Note/>`, `<code>…</code>`
  - `\n` line breaks, leading/trailing spaces, trailing punctuation
- Honor i18next **plural suffixes** (`_one`/`_other`, plus locale-specific like `_few`) — see grammar reference for the target language.

### 4. Merge back — WITHOUT churning the diff
- **Do NOT alphabetize.** The EN file is *not* sorted and locale files have their own historical order. Sorting produces a 2500-line diff for a 600-string change. Preserve existing key order; update changed values in place; append genuinely-new keys to the end of their parent object.
- **Preserve file formatting:** 2-space indent, **CRLF** line endings, trailing newline. `JSON.stringify(obj, null, 2)` then `.replace(/\n/g,"\r\n") + "\r\n"`.
- See `scripts.md` → *merge*.

### 5. Validate
- **Placeholder integrity** (programmatic — catches dropped/extra `{{…}}`, tags, `{keyword}`): `scripts.md` → *validate*. Must be 0 errors.
- **JSON + duplicate keys:** `pnpm --filter client test src/services/i18n.spec.ts` (the repo's only translation test — checks valid JSON and no duplicate keys; there's **no** locale-parity test and **no** typed-i18next, so adding `_few` not present in EN is fine and won't break typecheck).
- Re-run *measure* to confirm 100% (remaining "identical" entries should all be legitimate proper nouns).

## Pluralization is a SOURCE-SIDE decision

i18next only pluralizes when **(a)** the translation has plural-suffixed keys **and (b)** the call site passes `{ count }`. So:

- You may freely add locale-specific plural categories (e.g. Romanian `_few`) to an existing plural group — EN supplies `_one`/`_other`, the locale supplies `_one`/`_few`/`_other`.
- To pluralize a string that EN keeps as a **single form** (e.g. `"{{count}} notes"`), you must:
  1. Verify the call site passes `count` (`grep` for the key; look for `t("…", { count })`). If it doesn't, or the key is unused, **don't** pluralize.
  2. Convert the **English** key from base → `_one`/`_other` in `en/translation.json` (this is the sanctioned place to edit EN).
  3. Add the locale's `_one`/`_few`/`_other`.
  4. No code change needed — `t("key", {count})` resolves to the suffixed keys automatically.
- ⚠️ **Cross-locale cost:** converting an EN base key to plural removes the base key, so *all other locales* fall back to English for that string until Weblate migrates them. Call this out in the PR. Don't unilaterally edit the other ~36 locale files — let Weblate migrate.
- Skip strings i18next can't handle: more than one count-like variable (e.g. `"{{count}} sources from {{sites}} sites"` — only `count` triggers plurals).

## Auditing existing plurals

To find plural groups missing a locale-required category (e.g. Romanian `_few`) or the wrong `_other` form, enumerate EN keys with both `_one` and `_other`, then check the locale has all required categories. See `scripts.md` → *audit-plurals*.

## Common pitfalls

- Alphabetizing the file (massive diff) — don't.
- Writing LF instead of CRLF (whole-file diff) — convert to CRLF.
- Dropping a trailing `.` or a placeholder when copying a reviewer's suggestion — diff each suggestion carefully.
- Putting server strings in the client file or vice-versa — they're separate namespaces with separate EN sources.
