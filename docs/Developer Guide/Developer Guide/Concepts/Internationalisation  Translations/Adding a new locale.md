# Adding a new locale
Once the Weblate translations for a single language have reached ~50% in coverage, it's time to add it to the application.

To do so:

1.  In `packages/commons` look for `i18n.ts` and add a new entry to `UNSORTED_LOCALES` for the language.
2.  In `packages/commons` look for `dayjs.ts` and add a mapping for the new language in `DAYJS_LOADER`. Sort the entire list.
3.  In `apps/client`, look for `collections/calendar/index.tsx` and modify `LOCALE_MAPPINGS` to add support to the new language.
4.  In `apps/client`, look for `widgets/type_widgets/canvas/i18n.ts` and modify `LANGUAGE_MAPPINGS`. A unit test ensures that the language is actually loadable.
5.  In `packages/ckeditor5`, look for `i18n.ts` and modify `LOCALE_MAPPINGS`. The import validation should already check if the new value is supported by CKEditor, and there's also a test to ensure it. The test in `i18n.spec.ts` pins every locale by hand rather than iterating them, so add the new one there as well.
6.  In `apps/client`, look for `widgets/type_widgets/spreadsheet/locales.ts` and modify `UNIVER_LOCALES`, either with a source (if Univer ships a bundle for the language) or with an explicit `null` to fall back to English. Every preset in `SPREADSHEET_PRESET_PACKAGES` must have a bundle for the locale, which `locales.spec.ts` checks.
7.  Locale mappings for PDF.js might need adjustment. To do so, in `packages/pdfjs-viewer/scripts/build.ts` there is `LOCALE_MAPPINGS`. No entry is needed when the locale's `electronLocale` already names a directory under `packages/pdfjs-viewer/viewer/locale`.

Steps 1 to 6 are keyed by `DISPLAYABLE_LOCALE_IDS`, so `pnpm typecheck` reports each one still missing after step 1.

## The Electron locale

The `electronLocale` of the new entry names the Chromium locale the desktop application keeps for the language. When packaging, `trimElectronLocales` in `apps/desktop/electron-forge/trim-locales.ts` deletes every Chromium locale file no `electronLocale` names, and fails the build when one names a file Electron does not ship. The options page also lists a locale as a formatting locale only when it has an `electronLocale`.

The locale files of the Electron version the desktop application pins are recorded in `apps/desktop/electron-forge/electron-locales.json`:

*   If the language is listed there (for example `da.pak` or `pt-BR.pak`), set `electronLocale` to that name, with an underscore in place of the hyphen (`da`, `pt_BR`). `en-US.pak` is `"en"`.
*   If it is not listed, Chromium has no translation for the language. Set `electronLocale` to a locale it does ship, as Irish does with `"en"`, so that the language is still offered as a formatting locale.

`electronLocale` only decides which locale files the package keeps and which locales are offered for formatting. It does not choose Chromium's language: `getElectronLocale()` in `apps/desktop/src/main.ts` passes the id of the display language (or of the formatting locale) to Chromium's `--lang` switch.

`pnpm --filter desktop test trim-locales` runs the trim against those files and fails with "Locale … was not found in the packaged app" when the name is wrong. The same spec fails when the file records another Electron version than the one pinned in `apps/desktop/package.json`; after an Electron update, regenerate it with `pnpm chore:update-electron-locales` and commit the result.

## The website

The website tracks its own Weblate component and its own list, so a locale added to the application above is not offered on [triliumnotes.org](https://triliumnotes.org) until it is added there too.

1.  In `apps/website`, look for `locales.ts` and add an entry to `LOCALES`, using the language's own name and setting `rtl` where it applies. The id must match the folder under `apps/website/src/translations`, which Weblate creates.
2.  A locale carrying a region, such as `pt-BR`, is resolved by `mapLocale()` in `i18n.ts` by matching `LOCALES`, so it needs no further mapping. Chinese is the exception: it is selected by script, which browsers report only through the region, and `mapLocale()` special-cases it.

## The coverage gate

`scripts/translation/check-translation-coverage.mts` fails CI once Weblate reports a language above 50% that is missing from either list. It runs only on the pull requests Weblate opens, so the pull request that brings the translations in is where it fires.

The gate only catches a language that is translated but not offered. It does not notice one that is offered and has since fallen behind, and it does not check that the locale renders — only that the id is listed.