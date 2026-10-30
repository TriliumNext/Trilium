---
name: adding-a-display-language
description: Use when making a new language selectable in Trilium — "add Danish support", "enable <language>", "<language> is translated enough, ship it", or when the translation coverage gate fails because a language above 50% on Weblate is not offered. Covers checking the language is ready, registering it in `LOCALES` and every per-library mapping (dayjs, FullCalendar, Excalidraw, CKEditor, Univer, PDF.js), choosing its `electronLocale` and proving Electron ships that locale with the trim-locales spec, what to do when Chromium has no locale for the language, the website's separate list, and the tests to run. Translating the strings themselves is the translating-locales skill.
---

# Adding a display language

The translations arrive from Weblate on their own; what a maintainer adds is the **registration**: an
entry in `UNSORTED_LOCALES` (`packages/commons/src/lib/i18n.ts`) plus a mapping in every library that
renders its own UI. The step-by-step list is the Developer Guide page
`docs/Developer Guide/Developer Guide/Concepts/Internationalisation  Translations/Adding a new locale.md`
— read it and follow it. This skill adds what the page leaves to judgement: readiness, the Electron
check, and verification.

## 1. Is the language ready?

```bash
node scripts/translation/check-translation-coverage.mts          # Weblate: languages >50% but not offered
node .claude/skills/translating-locales/locale.mjs measure <id>  # repo: client / entry / server coverage
```

- The Trilium id is the folder name under `apps/client/src/translations/` (and
  `apps/server/src/assets/translations/`), which Weblate creates. No folder means no translations yet.
- The bar is ~50% client coverage. Below it, stop and say so rather than registering a mostly-English UI.
- The **website** is a separate Weblate component with its own list (`apps/website/src/locales.ts`).
  Measure `apps/website/src/translations/<id>/translation.json` against `en` the same way and add it
  there only when it clears 50% too; otherwise leave it out and say why in the commit body.

## 2. Register it

Follow the guide's steps. After step 1 (`UNSORTED_LOCALES`), `pnpm typecheck` names every
`Record<DISPLAYABLE_LOCALE_IDS, …>` still missing the id, so the library mappings cannot be forgotten.
For each library, check the bundle exists before mapping it — a guessed import path fails only at
runtime:

| Mapping | Bundle to look for | No bundle → |
|---|---|---|
| `DAYJS_LOADER` (`commons/src/lib/dayjs.ts`) | `node_modules/dayjs/locale/<code>.js` | closest locale |
| calendar `LOCALE_MAPPINGS` | `node_modules/fullcalendar/locales/<code>.js` | `null` |
| canvas `LANGUAGE_MAPPINGS` | `@excalidraw/excalidraw/dist/prod/locales/<code>-*.js` | `null` |
| ckeditor5 `LOCALE_MAPPINGS` + the `it.each` in `i18n.spec.ts` | `ckeditor5/dist/translations/<code>.js` | `null` |
| spreadsheet `UNIVER_LOCALES` | `@univerjs/preset-sheets-core/lib/locales/<code>.js` | `null` (English) |
| PDF.js `LOCALE_MAPPINGS` (`pdfjs-viewer/scripts/build.ts`) | `packages/pdfjs-viewer/viewer/locale/<electronLocale>` | entry naming the nearest directory |

`node_modules` is pnpm's layout, so resolve through Node when a path is not where you expect it
(`require.resolve("<pkg>/package.json")` from the consuming package). Also pick the Tesseract code
(`tesseractCode`, ISO 639-2, e.g. `dan`) and add it to the union on `Locale` if it is new.

## 3. The Electron locale

`electronLocale` names the **Chromium locale** the desktop build keeps for the language. Two things read
it:

- `trimElectronLocales` (`apps/desktop/electron-forge/trim-locales.ts`) deletes every Chromium locale
  file not named by an `electronLocale`, and **throws** — failing the packaging — when one names a file
  Electron does not ship. It runs in the forge `postPackage` hook and in the Flathub manifest.
- The options page lists a locale as a **formatting locale** only when it has an `electronLocale`.

The files Electron ships are recorded in `apps/desktop/electron-forge/electron-locales.json`, read from
the pinned release by `pnpm chore:update-electron-locales`. Look the language up there:

```bash
node -e 'const f=require("./apps/desktop/electron-forge/electron-locales.json");
  console.log(f.electronVersion, f.linux.filter((p) => p.startsWith(process.argv[1])))' da
```

- **Found** (`da.pak`, `pt-BR.pak`): set `electronLocale` to that name with `_` for `-` (`da`, `pt_BR`;
  `en-US.pak` is `"en"`). The `electronLocale` union on `Locale` mirrors this list, so the name is already
  a member.
- **Not found** — Chromium has no UI for the language. Point `electronLocale` at a locale Chromium does
  ship, so the language is still offered for formatting; the precedent is Irish,
  `{ id: "ga", electronLocale: "en" }`. Never add a name to the union that the JSON does not list: the
  type would accept it and the packaging would throw.

Then prove it — the spec builds its fixtures from the real file lists, so a wrong name fails here
instead of in a release build:

```bash
pnpm --filter desktop test trim-locales
```

- `Locale <x> was not found in the packaged app` — `electronLocale` names a file Electron does not ship.
  Fix the name; do not edit the JSON by hand.
- `electron-locales.json is out of date` — Electron was bumped without regenerating it. Run
  `pnpm chore:update-electron-locales` (network: a few hundred KB of range requests against the release
  zips) and commit the JSON in its own commit.

`electronLocale` does **not** choose Chromium's language. `getElectronLocale()`
(`apps/desktop/src/main.ts`) passes the Trilium id of the display language, or of the formatting locale,
to Chromium's `--lang`, so a fallback `electronLocale` never reaches Chromium. When Chromium's name and
the Trilium id can match, prefer the id that matches.

## 4. Verify

```bash
pnpm typecheck
pnpm --filter client test canvas/i18n spreadsheet/locales collections/calendar services/i18n utils/formatters
pnpm --filter @triliumnext/ckeditor5 test src/i18n.spec   # browser mode: Chromium via Playwright
pnpm --filter desktop test trim-locales
```

## 5. Commit

One `feat(i18n): add <Language> as a display language` commit. The body states the coverage figures,
then one line per mapping and what it maps to, and names every `null` and why (no Univer bundle, no
website because it is below 50%). Precedents: `git log --grep "as a display language"`,
`git log --grep "enable Irish"`. No User Guide page lists the languages, so there are no docs to update.
