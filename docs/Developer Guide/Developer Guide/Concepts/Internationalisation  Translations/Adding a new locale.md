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