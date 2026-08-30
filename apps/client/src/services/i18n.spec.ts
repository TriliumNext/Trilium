import { MESSAGE_KEY_PREFIX, MESSAGE_OVERRIDES, slugify } from "@triliumnext/ckeditor5";
import { dayjs, findDuplicateJsonKeys, findMalformedPluralGroups, findPluralKeyConflicts, LOCALES } from "@triliumnext/commons";
import { readdirSync, readFileSync } from "fs";
import i18next from "i18next";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the http backend so i18next.init() never hits the network. The real
// backend would try to fetch translation JSON over HTTP and the awaited init()
// would hang until the connection fails. Our fake backend resolves read()
// synchronously with an empty resource bundle.
vi.mock("i18next-http-backend", () => {
    class FakeBackend {
        static type = "backend" as const;
        type = "backend" as const;
        init() {
            // No configuration needed.
        }
        read(_language: string, _namespace: string, callback: (err: unknown, data: unknown) => void) {
            callback(null, {});
        }
    }
    return { default: FakeBackend };
});

const { getAvailableLocales, getCurrentLanguage, getLocaleById, initLocale, translationsInitializedPromise } = await import("./i18n");

/** Resolve a dotted i18next key against a parsed catalog. */
function resolveKey(translations: unknown, key: string): unknown {
    return key.split(".").reduce<unknown>(
        (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
        translations
    );
}

describe("i18n", () => {
    it("translations are valid JSON with no duplicate keys", () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.id === "en_rtl") {
                continue;
            }

            const translationPath = join(__dirname, "..", "translations", locale.id, "translation.json");
            const translationFile = readFileSync(translationPath, { encoding: "utf-8" });
            expect(() => JSON.parse(translationFile), `JSON error while parsing locale '${locale.id}' at "${translationPath}"`)
                .not.toThrow();

            const duplicates = findDuplicateJsonKeys(translationFile);
            expect(
                duplicates,
                `Duplicate keys in locale '${locale.id}' at "${translationPath}":\n${
                    duplicates.map((d) => `  - "${d.key}" (line ${d.line})`).join("\n")}`
            ).toEqual([]);

            // Weblate reads these files as i18next JSON v4, where a `_one`/`_other`/… suffix
            // marks a plural form. A section named that way is combined with the key before it
            // into a multistring and breaks the import of the whole file.
            const pluralConflicts = findPluralKeyConflicts(JSON.parse(translationFile));
            expect(
                pluralConflicts,
                `Keys in locale '${locale.id}' at "${translationPath}" that Weblate would read as plural forms but that are not translated strings:\n${
                    pluralConflicts.map((c) => `  - "${c.path}" (plural form '_${c.suffix}')`).join("\n")}`
            ).toEqual([]);
        }
    });

    // A `_one`/`_many`/… suffix is not part of a key: it is a plural form of the key before it,
    // to both i18next and Weblate. A key that merely reads that way — `open_all_too_many` for
    // "too many notes to open" — silently becomes one form of a plural whose other forms nobody
    // wrote, which Weblate counts as untranslated in the *source* language and then propagates,
    // empty, to every locale it manages.
    //
    // Only the English catalogs are checked, since they are the source Weblate imports: a
    // translation is free to leave a form empty until someone writes it, and several do.
    it("declares the plural forms English uses, and no others", () => {
        // Everything the setup wizard and login page need is in a catalog of its own, and the
        // server catalog is the one every non-browser runtime reads — Weblate imports all three.
        const catalogs = [
            join(__dirname, "..", "translations", "en", "translation.json"),
            join(__dirname, "..", "translations", "en", "entry.json"),
            join(__dirname, "..", "..", "..", "..", "apps", "server", "src", "assets", "translations", "en", "server.json")
        ];
        const categories = new Intl.PluralRules("en").resolvedOptions().pluralCategories;

        for (const catalogPath of catalogs) {
            const malformed = findMalformedPluralGroups(
                JSON.parse(readFileSync(catalogPath, { encoding: "utf-8" })), categories);

            expect(
                malformed,
                `Plural groups in "${catalogPath}" that do not match English's ${categories.join("/")} forms — a key that is not a plural must not end in one of those:\n${
                    malformed.map((g) => `  - "${g.path}" declares ${g.present.map((f) => `_${f}`).join(", ")}${
                        g.missing.length ? `, missing ${g.missing.map((f) => `_${f}`).join(", ")}` : ""}${
                        g.unexpected.length ? `, unexpected ${g.unexpected.map((f) => `_${f}`).join(", ")}` : ""}`).join("\n")}`
            ).toEqual([]);
        }
    });

    // i18next HTML-escapes interpolated values by default, so a value carrying a slash, an
    // apostrophe or a quote reaches the user as `blobs&#x2F;9`. Almost everything we interpolate is
    // rendered as text — a Preact child, a toast message, a `title` attribute — where that escaping
    // only produces gibberish, so `initLocale()` turns it off for every key and locale at once, and
    // the sinks that render a translated string as markup guard themselves instead.
    it("interpolates values without HTML-escaping them", async () => {
        (window as any).glob = { ...(window as any).glob, assetPath: "/assets" };
        await initLocale("en");
        i18next.addResourceBundle("en", "translation", {
            escaping: { probe: "{{value}}" }
        }, true, true);

        expect(i18next.t("escaping.probe", { value: `blobs/9 "New note" it's <b>` }))
            .toBe(`blobs/9 "New note" it's <b>`);
    });

    // The text editor localizes by passing the English text itself to the editor's translation
    // function, and that text resolves to `text-editor.ck.<slug>`. A string with no entry there
    // silently renders its English id in every locale — it is invisible to Weblate, so no
    // translator can ever supply it.
    //
    // Nothing here is declared by hand: the messages are gathered from the editor package's own
    // source, so a translation call added anywhere in any plugin is covered the moment it is
    // written. The check runs in both directions, so a stale or misspelled entry fails too.
    describe("editor messages", () => {
        const translationPath = join(__dirname, "..", "translations", "en", "translation.json");
        const editorSourcePath = join(__dirname, "..", "..", "..", "..", "packages", "ckeditor5", "src");

        // Matches `t("…")` however it is reached — bare, `editor.t(…)`, `this.t(…)`. `\bt\(` only
        // fires where `t` starts a word, so `insert(`, `expect(` and `_t(` are not mistaken for
        // translation calls. The first group captures the opening quote for the backreference.
        const TRANSLATION_CALL = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;

        // A dotted lowercase identifier is a key for the older host-translator bridge, which
        // resolves it against the app catalog directly rather than through a message dictionary.
        // Transitional: this can go once every plugin has moved over.
        const BRIDGE_KEY = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

        /** Every message id the editor package asks its translation function for. */
        function gatherEditorMessages(): string[] {
            const messages = new Set<string>();

            for (const entry of readdirSync(editorSourcePath, { recursive: true, withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) continue;

                const source = readFileSync(join(entry.parentPath, entry.name), { encoding: "utf-8" });
                for (const [ , , body ] of source.matchAll(TRANSLATION_CALL)) {
                    // Un-escape what the source had to escape to sit inside its quotes, so the
                    // result is the message id as the translation function receives it.
                    const message = body.replace(/\\(.)/g, "$1");
                    if (!BRIDGE_KEY.test(message)) {
                        messages.add(message);
                    }
                }
            }

            // Renames of CKEditor's own strings are declared rather than called, and the wording we
            // substitute needs an English entry like any other message.
            for (const replacement of Object.values(MESSAGE_OVERRIDES)) {
                messages.add(replacement);
            }

            return [ ...messages ];
        }

        /**
         * Message ids CKEditor already translates itself. Ours is merged after the core catalog, so
         * an entry for one of these would *override* the upstream translation in every locale —
         * which is a thing we do deliberately (`Bookmark` → `Anchor`), but never by accident. They
         * are recognized rather than listed: a message the German core catalog knows is upstream.
         */
        async function loadUpstreamMessages(): Promise<Set<string>> {
            const core = (await import("ckeditor5/translations/de.js")).default;
            return new Set(Object.keys(core.de.dictionary));
        }

        it("has an English entry for every message the plugins ask for", async () => {
            const translations = JSON.parse(readFileSync(translationPath, { encoding: "utf-8" }));
            const upstream = await loadUpstreamMessages();

            const missing = gatherEditorMessages()
                .filter((message) => !upstream.has(message))
                .map((message) => ({ message, key: MESSAGE_KEY_PREFIX + slugify(message) }))
                .filter(({ key }) => typeof resolveKey(translations, key) !== "string");

            expect(
                missing,
                `Editor messages with no entry in "${translationPath}":\n${
                    missing.map(({ message, key }) => `  - "${message}" → add "${key}"`).join("\n")}`
            ).toEqual([]);
        });

        /** The `text-editor.ck` section of every locale that has one, keyed by locale id. */
        function gatherEditorSections(): [ string, Record<string, string> ][] {
            const sections: [ string, Record<string, string> ][] = [];

            for (const locale of LOCALES) {
                if (locale.contentOnly || locale.id === "en_rtl") continue;

                const catalog = JSON.parse(readFileSync(
                    join(__dirname, "..", "translations", locale.id, "translation.json"),
                    { encoding: "utf-8" }
                ));
                const section = resolveKey(catalog, "text-editor.ck");
                if (section) sections.push([ locale.id, section as Record<string, string> ]);
            }

            // Guards the checks below against passing on an empty corpus, were the section ever
            // renamed or moved.
            if (sections.length < 2) throw new Error("expected editor messages in English and at least one translation");

            return sections;
        }

        /** The `%0`, `%1`, … a message interpolates, as a set — a translation may reorder them. */
        function placeholders(message: string): string[] {
            return [ ...new Set(message.match(/%\d/g) ?? []) ].sort();
        }

        // These strings are interpolated by CKEditor, which substitutes `%0`, `%1`, … — the
        // convention `translateMessage()` mirrors for the strings built before an editor exists.
        // i18next's `{{name}}` is never substituted on this path and would reach the user verbatim,
        // and it is an easy thing to reach for, since every other string in the catalog uses it.
        it("interpolates with CKEditor's %0 placeholders rather than i18next's {{…}}", () => {
            const offenders = [
                ...gatherEditorMessages().map((message) => [ "the editor sources", message ] as const),
                ...gatherEditorSections().flatMap(([ localeId, section ]) =>
                    Object.entries(section).map(([ key, value ]) => [ `${localeId} (${key})`, value ] as const))
            ].filter(([ , message ]) => /\{\{.*?\}\}/.test(message));

            expect(
                offenders.map(([ where, message ]) => `  - ${where}: "${message}"`),
                "Editor messages using i18next interpolation, which CKEditor leaves untouched:"
            ).toEqual([]);
        });

        // A translation that drops a placeholder swallows the value the editor passes for it; one
        // that invents a placeholder renders `%1` at the user, since nothing is substituted for it.
        it("keeps the placeholders of the English message in every translation", () => {
            const english = (resolveKey(
                JSON.parse(readFileSync(translationPath, { encoding: "utf-8" })), "text-editor.ck"
            ) ?? {}) as Record<string, string>;

            const mismatched = gatherEditorSections()
                .filter(([ localeId ]) => localeId !== "en")
                .flatMap(([ localeId, section ]) => Object.entries(section)
                    // A key English no longer declares is the orphan test's business, not this one.
                    .filter(([ key ]) => key in english)
                    .filter(([ key, value ]) => placeholders(value).join() !== placeholders(english[key]).join())
                    .map(([ key, value ]) =>
                        `  - ${localeId} "${key}": "${value}" carries ${
                            placeholders(value).join(", ") || "no placeholder"} where "${english[key]}" carries ${
                            placeholders(english[key]).join(", ") || "none"}`));

            expect(mismatched, "Translations whose placeholders don't match their English message:").toEqual([]);
        });

        it("has no English entry that no plugin asks for", () => {
            const translations = JSON.parse(readFileSync(translationPath, { encoding: "utf-8" }));
            const declared = (resolveKey(translations, "text-editor.ck") ?? {}) as Record<string, string>;
            const asked = new Set(gatherEditorMessages());

            const orphaned = Object.entries(declared)
                .filter(([ , english ]) => !asked.has(english))
                .map(([ key, english ]) => `  - "${MESSAGE_KEY_PREFIX}${key}" ("${english}")`);

            expect(
                orphaned,
                `Entries under "${MESSAGE_KEY_PREFIX}" that no editor string uses — the message was renamed or removed:\n${
                    orphaned.join("\n")}`
            ).toEqual([]);
        });
    });

    describe("getAvailableLocales", () => {
        function setDevBuild(isDev: boolean) {
            (window as unknown as { glob: { isDev: boolean } }).glob.isDev = isDev;
        }

        /**
         * Stands in for the name table `Intl` brings, so the answers it can give for a tag it cannot
         * name — a throw, or nothing at all — can be had from the locales we actually ship. No entry
         * in `LOCALES` draws either today: `en_rtl`, the one malformed tag among them, is turned away
         * by the English check before `Intl` ever sees it.
         */
        function stubDisplayNames(of: () => string | undefined) {
            vi.spyOn(Intl, "DisplayNames").mockImplementation(
                // A plain function rather than an arrow: this stands in for a constructor, and is
                // reached through `new`. Returning an object from one is what makes it the result.
                function () {
                    return { of };
                } as unknown as typeof Intl.DisplayNames
            );
        }

        afterEach(() => {
            setDevBuild(false);
            vi.restoreAllMocks();
        });

        it("returns the full LOCALES list", () => {
            expect(getAvailableLocales()).toBe(LOCALES);
        });

        it("annotates the names with their English equivalent in a development build", () => {
            setDevBuild(true);
            const names = Object.fromEntries(getAvailableLocales().map((l) => [ l.id, l.name ]));

            expect(names).toMatchObject({
                de: "Deutsch (German)",
                ko: "한국어 (Korean)",
                pt_br: "Português (Brasil) (Brazilian Portuguese)",
                // Resolved through `zh-Hans`/`zh-Hant`, so the script — the thing that separates the
                // two entries — is what the annotation states.
                cn: "简体中文 (Simplified Chinese)",
                tw: "繁體中文 (Traditional Chinese)"
            });
        });

        it("leaves the English entries alone, including the malformed dev-only tag", () => {
            setDevBuild(true);
            const names = Object.fromEntries(getAvailableLocales().map((l) => [ l.id, l.name ]));

            expect(names).toMatchObject({
                en: "English (United States)",
                "en-GB": "English (United Kingdom)",
                en_rtl: "English RTL"
            });
        });

        it("shows the native name alone for a tag Intl refuses", () => {
            // A tag `Intl` cannot parse is a RangeError rather than an empty answer, and a locale
            // added later with an id like `en_rtl`'s would be one. The list has to survive it.
            setDevBuild(true);
            stubDisplayNames(() => { throw new RangeError("malformed tag"); });

            const names = Object.fromEntries(getAvailableLocales().map((l) => [ l.id, l.name ]));

            expect(names.de).toBe("Deutsch");
            expect(names.ko).toBe("한국어");
        });

        it("shows the native name alone where Intl has no name to give", () => {
            setDevBuild(true);
            stubDisplayNames(() => undefined);

            const names = Object.fromEntries(getAvailableLocales().map((l) => [ l.id, l.name ]));

            expect(names.de).toBe("Deutsch");
        });

        it("does not mutate the shared LOCALES entries", () => {
            const before = LOCALES.map((l) => l.name);
            setDevBuild(true);
            getAvailableLocales();

            expect(LOCALES.map((l) => l.name)).toEqual(before);
        });
    });

    describe("getLocaleById", () => {
        it("returns null for falsy locale ids", () => {
            expect(getLocaleById(null)).toBeNull();
            expect(getLocaleById(undefined)).toBeNull();
            expect(getLocaleById("")).toBeNull();
        });

        it("returns the matching locale for a known id", () => {
            const locale = getLocaleById("en");
            expect(locale).not.toBeNull();
            expect(locale?.id).toBe("en");
        });

        it("returns null for an unknown id", () => {
            expect(getLocaleById("does-not-exist")).toBeNull();
        });
    });

    describe("initLocale", () => {
        it("initializes i18next with an explicit locale, sets dayjs and resolves the deferred", async () => {
            (window as any).glob = { ...(window as any).glob, assetPath: "/assets" };

            await initLocale("de");

            expect(getCurrentLanguage()).toBe("de");
            // The second responsibility of initLocale is `await setDayjsLocale(locale)`, which
            // switches the global dayjs locale. Assert the observable side effect so removing or
            // mis-passing the locale to setDayjsLocale would be caught.
            expect(dayjs.locale()).toBe("de");
            // The deferred resolves once translations are ready.
            await expect(translationsInitializedPromise).resolves.toBeUndefined();
        });

        it("uses the default 'en' locale when called without arguments", async () => {
            await initLocale();
            expect(getCurrentLanguage()).toBe("en");
        });
    });

    describe("getCurrentLanguage", () => {
        it("reflects the language i18next was last initialized with", async () => {
            await initLocale("en");
            expect(getCurrentLanguage()).toBe("en");
        });
    });
});
