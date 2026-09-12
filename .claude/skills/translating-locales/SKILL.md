---
name: translating-locales
description: Use when filling in or improving a lagging UI translation locale in Trilium (e.g. "Romanian is behind", "bring <locale> to 100% coverage", "translate the missing strings"). Covers measuring the gap vs English, drafting translations that preserve i18next placeholders, merging without diff churn, locale grammar rules (Romanian plurals/gender), the source-side pluralization workflow, how Weblate sync actually works (merging is picked up), and validation. Includes locale.mjs — don't hand-roll a JSON walker.
---

# Translating / improving a locale in Trilium

Trilium's UI is localized with **i18next**. English is the source of truth; other locales are normally crowd-translated via **Hosted Weblate**. This skill is for the *maintainer* case: deliberately filling a locale that lags behind (the recurring one is Romanian, `ro`).

**Scope — this skill *fills* an already-registered locale.** To **add a brand-new locale** (e.g. Polish) you must first do the one-time registration and build wiring; that's a separate task. Follow `docs/Developer Guide/Developer Guide/Concepts/Internationalisation  Translations/Adding a new locale.md` to register it, then come back here to translate the strings.

Every mechanical step is [locale.mjs](locale.mjs) — measure, export, validate, merge, audit. Read [romanian.md](romanian.md) for Romanian grammar and terminology.

```bash
S=.claude/skills/translating-locales/locale.mjs
node $S measure                                   # coverage of every locale, both catalogs
node $S measure ro -v                             # one locale, listing missing + untranslated keys
node $S export ro client --chunk 150              # work list (English source) → a temp dir
node $S validate ro client <files…>               # placeholders / whitespace / plural categories
node $S merge ro client <files…>                  # apply, preserving key order + formatting
node $S audit-plurals ro client                   # groups missing a category the locale requires
```

`export` writes `{ key: englishValue }`; translate into a flat `{ key: translatedValue }` file and feed it to `validate` then `merge`. Chunking matters: a locale that is 1000+ strings behind does not fit one drafting pass, and `validate`/`merge` both take a list of files.

## How Weblate sync works here (merging a PR IS picked up — no separate upload needed)

Weblate is linked to this repo with the **GitHub pull-request push method**: `.github/workflows/i18n.yml` triggers on `push` to `weblate:*` branches, and Weblate opens PRs into the repo (the recurring `Translations update from Hosted Weblate (#…)` PRs). The locale `translation.json` / `server.json` files are tracked Weblate **components**. Consequently:

- **Merging a PR that edits a locale file IS picked up by Weblate.** On its next pull of the default branch, Weblate imports the new/changed translations into its database — they persist and show up for other contributors. They are **not** discarded or overwritten. With the PR-based push method Weblate never force-pushes the default branch, so the repo is authoritative and Weblate merges *from* it.
- A direct-to-repo PR is therefore a fully valid, durable way to land translations. **You do NOT need to separately upload the file into Weblate.**
- This is the opposite of arbitrary repo files (README, docs): those aren't part of any Weblate component, so Weblate simply ignores them.
- Real (narrow) caveat: a true conflict only arises if the **same key** is edited simultaneously in Weblate (pending, un-pushed) *and* in the repo — then Weblate's merge/rebase conflict handling picks the winner. Filling previously-empty/untranslated strings doesn't conflict.
- `CLAUDE.md`'s "only add new keys to `en/translation.json`" rule is about where *new source strings* originate (so they enter the translation pipeline), **not** a prohibition on landing translations for an existing locale via the repo.
- Changing an **English source** string (e.g. pluralizing a key) makes Weblate flag the matching translations in *other* locales as needing review and drop orphaned removed-key entries — normal, and it doesn't affect the locale you just filled.

## File locations

| Catalog | English source | Target locale |
|---|---|---|
| `client` — the browser UI | `apps/client/src/translations/en/translation.json` | `apps/client/src/translations/<locale>/translation.json` |
| `entry` — setup wizard, login, password reset | `apps/client/src/translations/en/entry.json` | `apps/client/src/translations/<locale>/entry.json` |
| `server` — everything else | `apps/server/src/assets/translations/en/server.json` | `apps/server/src/assets/translations/<locale>/server.json` |

All three have their own EN↔locale pair — do **all three**; `measure` reports them side by side. `entry` is easy to forget: it is a separate i18next namespace loaded on its own by the three pre-login pages, so a locale can read 100% on `client` while its login screen is entirely English. Several of its keys (`login.*`, the SSO errors) are near-duplicates of `server.json` ones — translate them the same way.

`server.json` is misnamed: it is the catalog for **every** runtime outside the browser UI — `apps/server`, the Electron main process, `packages/trilium-core`, and the standalone worker, which loads it with `ns: "server"` from the copy of `apps/server/src/assets` that its vite build emits under `server-assets`. Translating it therefore covers the standalone and mobile builds too, and a missing key there is not "server-only" breakage.

## Workflow

### 1. Measure the gap
`node $S measure <locale> -v`. Two numbers matter: **missing** (absent from the locale) and **untranslated** (present but byte-identical to English). The latter is mostly legitimate proper nouns — `-v` lists them so you can tell.

### 2. Export the work list
`node $S export <locale> <catalog> --chunk 150`. Chunks of ~150 strings keep each drafting pass reviewable; `--out DIR` if you want them somewhere specific (default: a fresh temp dir).

### 3. Draft the translations
- **Probe the existing file first and match its terminology and tone.** RO uses `notiță` for "note", `Anulează` for "Cancel", formal-plural address (`Selectați`). Don't invent a second term for something the file already names.
- **Keep proper nouns and kept technical terms in English**: ETAPI, MCP, OAuth/OpenID, Markdown, Widget, Mermaid, Bing/Google/Gantt/Kanban/…, and words spelled the same in the target language. Also keep **literal UI labels of other products** quoted in English (Notion's "Create folders for subpages") — the user has to find that exact control.
- **Preserve every placeholder exactly** (the #1 source of bugs) — `validate` checks all of these:
  - `{{var}}`, `{{- var}}` (unescaped — keep the hyphen), `{keyword}` (single-brace, e.g. date patterns and search-engine URLs)
  - JSX/`<Trans>` tags: `<buildRevision />`, `<Note/>`, `<code>…</code>`; HTML entities like `&rarr;`
  - `\n` line breaks, leading/trailing spaces, trailing punctuation
- Honor i18next **plural suffixes** — the locale's required categories, not English's two. See below.
- **Copy each form's placeholders from its own English key, not from the group.** English often writes `_one` without `{{count}}` ("An archived note was copied here", "1 hidden note") while `_other` has it. `validate` compares a locale-only `_few` against `_other`, so put `{{count}}` in `_few`/`_other` and leave `_one` as English left it.

### 4. Validate, then merge
`node $S validate` must print **0 errors** before you merge. Then `node $S merge`, and check `git diff --stat`: a 600-string change is ~600 added lines, **not** thousands.

`merge` preserves what a naive `JSON.stringify` round-trip destroys:
- **Key order.** Never alphabetize — neither the EN file nor the locale files are sorted, and sorting turns a 600-string change into a 2500-line diff. New keys are appended to their parent object.
- **Formatting.** Indent, EOL and the trailing newline are detected from the file being written. The catalogs are currently **LF**; do not hard-code CRLF (an earlier version of this skill did, and it rewrites every line).

### 5. Final checks
```bash
node $S audit-plurals <locale> <catalog>
node $S measure <locale>                          # expect 100%; leftovers should be proper nouns
pnpm --filter client test src/services/i18n.spec.ts
```
`i18n.spec.ts` is the repo's only translation test — valid JSON, no duplicate keys, plus the CKEditor message-catalog check. There is **no** locale-parity test and **no** typed-i18next, so adding a `_few` that English lacks is fine and won't break `pnpm typecheck`.

## Pluralization is a SOURCE-SIDE decision

i18next only pluralizes when **(a)** the translation has plural-suffixed keys **and (b)** the call site passes `{ count }`. So:

- You may freely add locale-specific plural categories (Romanian `_few`, Russian `_many`) to an existing plural group — EN supplies `_one`/`_other`, the locale supplies its own set. `locale.mjs` derives the required set from `Intl.PluralRules`, so `validate` accepts exactly the categories the locale uses and rejects the ones it doesn't.
- To pluralize a string that EN keeps as a **single form** (e.g. `"{{count}} notes"`), you must:
  1. Verify the call site passes `count` (`grep` for the key; look for `t("…", { count })`). If it doesn't, or the key is unused, **don't** pluralize.
  2. Convert the **English** key from base → `_one`/`_other` in `en/translation.json` (this is the sanctioned place to edit EN).
  3. Add the locale's own categories.
  4. No code change needed — `t("key", {count})` resolves to the suffixed keys automatically.
- ⚠️ **Cross-locale cost:** converting an EN base key to plural removes the base key, so *all other locales* fall back to English for that string until Weblate migrates them. Call this out in the PR. Don't unilaterally edit the other ~36 locale files — let Weblate migrate.
- Skip strings i18next can't handle: more than one count-like variable (e.g. `"{{count}} sources from {{sites}} sites"` — only `count` triggers plurals).

### Editing the English file by hand

For a handful of in-place EN edits (pluralizing one key, fixing a typo), do **text-level** replacement — never `JSON.parse → stringify` the EN file, which can reformat or re-escape unrelated lines:

```js
const fs = require("fs");
function replaceOnce(path, pairs) { // pairs: [[oldLine, [newLine1, newLine2, …]], …]
    let s = fs.readFileSync(path, "utf8");
    const E = s.includes("\r\n") ? "\r\n" : "\n";
    for (const [oldL, newLines] of pairs) {
        if (s.indexOf(oldL) === -1) throw new Error("NOT FOUND: " + oldL);
        if (s.split(oldL).length > 2) throw new Error("NOT UNIQUE: " + oldL);
        s = s.replace(oldL, newLines.join(E));
    }
    fs.writeFileSync(path, s, "utf8");
}
```

## Common pitfalls

- Alphabetizing the file (massive diff) — `merge` won't, don't do it by hand either.
- Writing the wrong EOL (whole-file diff) — `merge` detects it; a hand-written `stringify` won't.
- Dropping a trailing `.` or a placeholder when copying a reviewer's suggestion — re-run `validate` after applying review feedback, not just after the first draft.
- Putting server strings in the client file or vice-versa — separate namespaces, separate EN sources.
- Translating a string whose English *is* a foreign UI label the user must click.
