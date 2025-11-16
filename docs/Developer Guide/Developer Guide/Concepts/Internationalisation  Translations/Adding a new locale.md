# Adding a new locale
Once the Weblate translations for a single language have reached ~50% in coverage, it's time to add it to the application.

To do so:

1.  In `packages/commons` look for `i18n.ts` and add a new entry to `UNSORTED_LOCALES` for the language.
2.  In `apps/server` look for `services/i18n.ts` and add a mapping for the new language in `DAYJS_LOADER`. Sort the entire list.
3.  In `apps/client`, look for `collections/calendar/index.tsx` and modify `LOCALE_MAPPINGS` to add support to the new language.
4.  In `apps/client`, look for `widgets/type_widgets/canvas/i18n.ts` and modify `LANGUAGE_MAPPINGS`. A unit test ensures that the language is actually loadable.
5.  In `apps/client`, look for `widgets/type_widgets/MindMap.tsx` and modify `LOCALE_MAPPINGS`. The type definitions should already validate if the new value is supported by Mind Elixir.
6.  In `packages/ckeditor5`, look for `i18n.ts` and modify `LOCALE_MAPPINGS`. The import validation should already check if the new value is supported by CKEditor, and there's also a test to ensure it.