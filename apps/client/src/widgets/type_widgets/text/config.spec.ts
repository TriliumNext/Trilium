import type { EditorConfig } from "@triliumnext/ckeditor5";
import { DISPLAYABLE_LOCALE_IDS, IMAGE_MIMES, LOCALES, SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import imageService from "../../../services/image.js";
import noteAutocompleteService from "../../../services/note_autocomplete.js";
import { ensureMimeTypesForHighlighting } from "../../../services/syntax_highlight.js";
import { buildConfig, type BuildEditorOptions, OPEN_SOURCE_LICENSE_KEY } from "./config.js";

// Mutable option values, reset before each test (see `beforeEach`).
const optionsState = vi.hoisted(() => ({
    map: {} as Record<string, string | undefined>,
    json: {} as Record<string, unknown>
}));
// Toggles whether the editor advertises raw-image clipboard support.
const imageState = vi.hoisted(() => ({ copySupported: false }));

// The app catalog, as far as the config is concerned: `bundle` is the `translation` namespace the
// editor messages are read back from, and `t` resolves a key against `entries`. Unknown keys echo
// back the way i18next does for a missing entry, which keeps every lookup visible in the assertions
// rather than resolving to `undefined` against an uninitialized i18n.
const catalogState = vi.hoisted(() => ({
    bundle: undefined as Record<string, unknown> | undefined,
    entries: {} as Record<string, string>
}));
vi.mock("../../../services/i18n.js", () => ({
    t: (key: string) => catalogState.entries[key] ?? key,
    // Read while the AI assistant's Translate submenu is built, which every config goes through.
    getAvailableLocales: () => []
}));
vi.mock("i18next", () => ({
    default: {
        // i18next binds `getResourceBundle` in `init()`, so it is absent until the app has booted —
        // the case for a test that builds a config without one.
        get getResourceBundle() {
            return catalogState.bundle && (() => catalogState.bundle);
        }
    }
}));

vi.mock("../../../services/options.js", () => ({
    default: {
        get(name: string) {
            if (name in optionsState.map) return optionsState.map[name];
            if (name === "allowedHtmlTags") return "[]";
            // The replacement groups ship on, so an unset option here has to answer the way the
            // real defaults do — otherwise every test would silently run with them all disabled.
            if (name.startsWith("textNote") && name.endsWith("ReplacementsEnabled")) return "true";
            return undefined;
        },
        getJson(name: string) {
            if (name === "codeNotesMimeTypes") {
                return ["text/javascript", "application/javascript;env=frontend", "application/javascript;env=backend", "text/css"];
            }
            if (name in optionsState.json) return optionsState.json[name];
            return [];
        },
        is(name: string) {
            return optionsState.map[name] === "true";
        }
    }
}));

// buildConfig reads the `_taskStates` hidden subtree via Froca; stub it out.
vi.mock("../../../services/task_states.js", () => ({
    getTaskStateDefinitions: async () => [],
    openCustomTaskStateConfig: () => {}
}));

// Image clipboard support and the copy/download actions are environment-dependent; stub them.
vi.mock("../../../services/image.js", () => ({
    default: {
        isImageCopySupported: () => imageState.copySupported,
        copyImageToClipboard: vi.fn(),
        downloadImage: vi.fn()
    }
}));

vi.mock("../../../services/note_autocomplete.js", () => ({
    default: {
        autocompleteSourceForCKEditor: vi.fn(async () => [])
    }
}));

// Keep the real module, but skip the actual theme/mime loading the lazy loader would trigger.
vi.mock("../../../services/syntax_highlight.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/syntax_highlight.js")>()),
    ensureMimeTypesForHighlighting: vi.fn(async () => {})
}));

// Heavy modules pulled in lazily by the editor config — replace with light stubs.
vi.mock("mermaid", () => ({ default: { name: "mermaid-stub" } }));
vi.mock("@triliumnext/highlightjs", () => ({ default: { name: "hljs-stub" } }));
vi.mock("../../../services/math.js", () => ({ default: { name: "katex-stub" } }));

function baseOpts(overrides: Partial<BuildEditorOptions> = {}): BuildEditorOptions {
    return {
        uiLanguage: "en",
        contentLanguage: "en",
        isClassicEditor: false,
        templates: [],
        ...overrides
    };
}

interface MentionSuggestion {
    icon?: string;
    action?: string;
    highlightedNotePathTitle?: string;
}

/** The dynamically-attached config members that CKEditor's `EditorConfig` type doesn't declare. */
interface DynamicConfig {
    renderShortcut(shortcut: string): string;
    autoLinkPreviewsEnabled(): boolean;
    imageActions: {
        copyToClipboard(src: string): void;
        download(src: string): void;
    };
    math: { lazyLoad(): Promise<void> };
    mermaid: { lazyLoad(): Promise<unknown> };
    syntaxHighlighting: { loadHighlightJs(): Promise<{ default: unknown }> };
    mention?: {
        feeds: {
            marker: string;
            minimumCharacters: number;
            feed(queryText: string): Promise<unknown>;
            itemRenderer(item: MentionSuggestion): HTMLElement;
        }[];
    };
}

async function buildDynamicConfig(overrides: Partial<BuildEditorOptions> = {}) {
    return await buildConfig(baseOpts(overrides)) as unknown as DynamicConfig;
}

beforeEach(() => {
    optionsState.map = {};
    optionsState.json = {};
    imageState.copySupported = false;
    catalogState.bundle = undefined;
    catalogState.entries = {};
    window.glob.isDev = false;
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("CK config", () => {
    it("maps all languages correctly", async () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.devOnly) continue;

            const config = await buildConfig(baseOpts({
                uiLanguage: locale.id as DISPLAYABLE_LOCALE_IDS,
                contentLanguage: locale.id
            }));

            let expectedLocale = locale.id.substring(0, 2);
            if (expectedLocale === "cn") expectedLocale = "zh";
            if (expectedLocale === "tw") expectedLocale = "zh-tw";

            if (locale.id !== "en" && locale.id !== "ga") {
                expect((config.language as unknown as { ui: string }).ui).toMatch(new RegExp(`^${expectedLocale}`));
                expect(config.translations, locale.id).toBeDefined();
                // The merge seed, CKEditor's GPL core translations, and the Trilium dictionary. The
                // premium bundle used to contribute another entry, but no premium plugin is loaded
                // any more. i18next is not initialized here, so the dictionary holds only the
                // renames of CKEditor's own strings — those apply with or without a catalog — and
                // every other editor string falls back to its English message id.
                expect(config.translations, locale.id).toHaveLength(3);
            }
        }
    }, 20_000);

    // The `text-editor.ck` section of the English catalog is the registry of editor strings: each
    // entry names the English message id a plugin passes to `editor.t()`, and the value the editor
    // gets for it is that key resolved through the app's i18n.
    it("claims exactly the media types the upload endpoint stores as images", async () => {
        const config = await buildConfig(baseOpts());
        const types = (config.image as { upload: { types: string[] } }).upload.types;
        // The editor decides whether a dropped file is a picture with this exact expression (see
        // createImageTypeRegExp) — anchored, so a subtype has to be listed in full.
        const claimed = new RegExp(`^image\\/(${types.map((type) => type.replace("+", "\\+")).join("|")})$`);

        for (const mime of IMAGE_MIMES) {
            expect(claimed.test(mime), mime).toBe(true);
        }

        // And nothing beyond them. A type the editor claims but the endpoint does not store as an
        // image is the worse half of the mismatch: the editor inserts a picture, the endpoint
        // answers with a `#root/...` file reference, and that goes into the <img src> unexamined.
        expect(types.length).toBe(IMAGE_MIMES.length);
        // TIFF is the one deliberately left out — no browser but Safari draws one in an <img>.
        expect(claimed.test("image/tiff")).toBe(false);
    });

    it("turns the English editor catalog into the dictionary the editor resolves messages through", async () => {
        catalogState.bundle = { "text-editor": { ck: { "insert-a-table": "Insert a table." } } };
        catalogState.entries["text-editor.ck.insert-a-table"] = "Tabelle einfügen";

        const config = await buildConfig(baseOpts({ uiLanguage: "de" }));

        const translations = config.translations as Record<string, { dictionary: Record<string, string> }>[];
        // Ours is merged last, after CKEditor's own translations.
        expect(translations.at(-1)?.de.dictionary["Insert a table."]).toBe("Tabelle einfügen");
    });

    it("excludes Trilium frontend/backend script JS variants from code-block languages", async () => {
        const config = await buildConfig(baseOpts());

        const languages = (config.codeBlock?.languages ?? []).map((l) => l.language);
        // Plain JavaScript (and other code languages) remain selectable.
        expect(languages).toContain("text-javascript");
        expect(languages).toContain("text-css");
        // The script-environment variants are meaningless in a display-only code block.
        expect(languages).not.toContain("application-javascript-env-frontend");
        expect(languages).not.toContain("application-javascript-env-backend");
    });

    it("wires the MathLive→KaTeX compatibility macros into the math engine", async () => {
        const config = await buildConfig(baseOpts());

        const macros = (config.math as { katexRenderOptions?: { macros?: Record<string, string> } } | undefined)
            ?.katexRenderOptions?.macros;
        // Without this mapping, MathLive's \differentialD renders as raw error text (issue #9523).
        expect(macros?.["\\differentialD"]).toBe("\\mathrm{d}");
    });
});

describe("CK config - HTML support", () => {
    // The feature ships off, so everything below the first two tests describes what an install that
    // has opted back in gets.
    beforeEach(() => {
        optionsState.map.textNoteHtmlSupportEnabled = "true";
    });

    it("keeps GHS out of the way until the user opts in", async () => {
        optionsState.map.textNoteHtmlSupportEnabled = "false";
        optionsState.map.allowedHtmlTags = JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS);

        const config = await buildConfig(baseOpts());

        // The allow-list is emptied rather than narrowed: GHS decides per element, so there is no
        // subset of the option that still means anything once the feature is off. The tag list goes
        // on governing what the server-side sanitizer accepts on import.
        expect(config.htmlSupport?.allow).toEqual([]);
    });

    it("treats an unset option as off, the way the shipped default is", async () => {
        // An install predating the option has no row for it, and must not silently run with GHS on.
        delete optionsState.map.textNoteHtmlSupportEnabled;
        optionsState.map.allowedHtmlTags = JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS);

        const config = await buildConfig(baseOpts());

        expect(config.htmlSupport?.allow).toEqual([]);
    });

    it("names every allowed tag rather than handing GHS bare strings", async () => {
        optionsState.map.allowedHtmlTags = JSON.stringify(["p", "section", "en-media"]);

        const config = await buildConfig(baseOpts());

        // The shape is the whole point: `DataFilter#loadAllowedConfig` falls back to a
        // match-everything pattern for an entry with no `name`, so a list of plain strings allowed
        // every element — including the `$customElement` catch-all, which round-tripped unknown tags
        // as opaque blobs that were invisible and un-navigable in the editing view (#10989).
        expect(config.htmlSupport?.allow).toEqual([
            { name: "p", attributes: true, classes: true, styles: true },
            { name: "section", attributes: true, classes: true, styles: true },
            { name: "en-media", attributes: true, classes: true, styles: true }
        ]);
        // Nothing is disallowed outright; the allow-list alone decides.
        expect(config.htmlSupport?.disallow).toBeUndefined();
    });

    it("allows nothing beyond the natively supported elements when the list is empty", async () => {
        const config = await buildConfig(baseOpts());

        expect(config.htmlSupport?.allow).toEqual([]);
    });

    it("withholds div from the editor even when the option allows it", async () => {
        // GHS gives div a dual content model — a paragraph impostor around inline content, an
        // affordance-less container around a block — which is what strands the caret in a wrapped
        // code block. Unwrapping it is the point; the sanitizer reads the same option and is
        // deliberately left accepting div on import.
        optionsState.map.allowedHtmlTags = JSON.stringify(["div", "p", "section"]);

        const config = await buildConfig(baseOpts());

        expect(config.htmlSupport?.allow).toEqual([
            { name: "p", attributes: true, classes: true, styles: true },
            { name: "section", attributes: true, classes: true, styles: true }
        ]);
    });

    it("withholds div from the shipped default list too", async () => {
        // The default is what nearly every install runs with, so the filter has to bite there
        // rather than only on a hand-edited list.
        optionsState.map.allowedHtmlTags = JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS);

        const config = await buildConfig(baseOpts());

        const names = (config.htmlSupport?.allow ?? []).map((pattern) => (pattern as { name: string }).name);
        expect(names).not.toContain("div");
        // Everything else the default list names still comes through.
        expect(names).toEqual(SANITIZER_DEFAULT_ALLOWED_TAGS.filter((tag) => tag !== "div"));
    });
});

describe("CK config - licensing", () => {
    it("always runs under the open-source license, with no premium plugins", async () => {
        // Every premium plugin Trilium used has an in-tree GPL replacement, so there is no
        // commercial key to read and nothing to add on top of the built-in plugin list.
        const config = await buildConfig(baseOpts());

        expect(config.licenseKey).toBe(OPEN_SOURCE_LICENSE_KEY);
        expect(config.extraPlugins).toBeUndefined();
    });
});

describe("CK config - language & emoji", () => {
    it("omits the content-language override when no content language is given", async () => {
        const config = await buildConfig(baseOpts({ uiLanguage: "en", contentLanguage: null }));

        // With no content language the `language` override is skipped entirely; "en" has no CK locale mapping.
        expect(config.language).toBeUndefined();
    });

    it("resolves the content language from the note, then the default, then the UI language", async () => {
        optionsState.map.defaultContentLanguage = "fr";
        optionsState.map.locale = "ru";

        // The note's own `#language` outranks both options.
        expect((await buildConfig(baseOpts({ contentLanguage: "de" }))).language).toMatchObject({ content: "de" });
        // Without one, the default content language answers.
        expect((await buildConfig(baseOpts({ contentLanguage: null }))).language).toMatchObject({ content: "fr" });
        // ...and its empty "auto" value follows the application's language instead.
        optionsState.map.defaultContentLanguage = "";
        expect((await buildConfig(baseOpts({ contentLanguage: null }))).language).toMatchObject({ content: "ru" });
    });

    it("derives the quote style from that same resolved language", async () => {
        const quotesOf = (config: Awaited<ReturnType<typeof buildConfig>>) =>
            (config.typing?.transformations.extra ?? []).map((t) => (t as { to: string[] }).to);

        optionsState.map.defaultContentLanguage = "fr";
        optionsState.map.locale = "ru";

        expect(quotesOf(await buildConfig(baseOpts({ contentLanguage: "de" })))).toEqual([
            [null, "„", null, "“"],
            [null, "‚", null, "‘"]
        ]);

        // With no note language, the default content language decides.
        expect(quotesOf(await buildConfig(baseOpts({ contentLanguage: null })))).toEqual([
            // The gap inside the guillemets is U+202F, the narrow no-break space French sets
            // there — it looks like a plain space but is not one.
            [null, "« ", null, " »"],
            [null, "“", null, "”"]
        ]);

        // ...and the "auto" value follows the UI language.
        optionsState.map.defaultContentLanguage = "";
        expect(quotesOf(await buildConfig(baseOpts({ contentLanguage: null })))).toEqual([
            [null, "«", null, "»"],
            [null, "„", null, "“"]
        ]);
    });

    it("leaves CKEditor's own quotes in force for a locale with no mapping", async () => {
        const config = await buildConfig(baseOpts({ contentLanguage: "ku" }));

        // Not removed, so CKEditor's own quotes still run — better than a locale we have no pair for
        // losing quote replacement altogether.
        expect(config.typing?.transformations.remove).not.toContain("quotesPrimary");
        expect(config.typing?.transformations.remove).not.toContain("quotesSecondary");
        expect(config.typing?.transformations.extra).toEqual([]);
        // The language itself still applies, so right-to-left text lays out correctly regardless.
        expect(config.language).toMatchObject({ content: "ku" });
    });

    it("expresses the enabled groups as deltas, leaving CKEditor's defaults to upstream", async () => {
        // All four groups on: only the two quote transformations are taken over, and only because we
        // supply our own. Named individually rather than as the `quotes` group, which would take both
        // away together — they are configured apart.
        const allOn = await buildConfig(baseOpts({ contentLanguage: "de" }));
        expect(allOn.typing?.transformations.remove).toEqual(["quotesPrimary", "quotesSecondary"]);
        expect(allOn.typing?.transformations.extra).toHaveLength(2);

        // Each toggle removes its group by name, so the patterns behind the dashes and fractions
        // stay upstream's rather than being restated here.
        optionsState.map.textNotePunctuationReplacementsEnabled = "false";
        optionsState.map.textNoteMathReplacementsEnabled = "false";
        optionsState.map.textNoteSymbolReplacementsEnabled = "false";
        const allOff = await buildConfig(baseOpts({ contentLanguage: "de" }));
        expect(allOff.typing?.transformations.remove).toEqual([
            "typography", "mathematical", "symbols", "quotesPrimary", "quotesSecondary"
        ]);
    });

    it("settles the two quote keys apart", async () => {
        const quotesOf = (config: Awaited<ReturnType<typeof buildConfig>>) =>
            (config.typing?.transformations.extra ?? []).map((t) => (t as { to: string[] }).to);

        // Guillemets on the double key, the language's own marks left on the single one — the mix
        // that a single dropdown could not express.
        optionsState.map.textNoteDoubleQuoteStyle = "guillemets";
        const config = await buildConfig(baseOpts({ contentLanguage: "de" }));

        expect(quotesOf(config)).toEqual([
            [null, "«", null, "»"],
            [null, "‚", null, "‘"]
        ]);

        // Switching one off leaves the other running.
        optionsState.map.textNoteSingleQuoteStyle = "off";
        const halfOff = await buildConfig(baseOpts({ contentLanguage: "de" }));
        expect(quotesOf(halfOff)).toEqual([[null, "«", null, "»"]]);
        expect(halfOff.typing?.transformations.remove).toContain("quotesSecondary");
    });

    it("adds the user's own replacements alongside the quote ones", async () => {
        optionsState.map.textNoteCustomReplacements = `[{"from":"TN","to":"Trilium Notes"},{"from":"half","to":""}]`;

        const config = await buildConfig(baseOpts({ contentLanguage: "de" }));

        // Two quote transformations plus the one finished custom pair; the half-written row compiles
        // to nothing rather than acting before it is done.
        expect(config.typing?.transformations.extra).toHaveLength(3);
        expect(String((config.typing?.transformations.extra?.[2] as { from: RegExp }).from)).toContain("TN");
    });

    it("survives a custom replacements option that cannot be read", async () => {
        optionsState.map.textNoteCustomReplacements = "}} not json {{";

        const config = await buildConfig(baseOpts({ contentLanguage: "de" }));

        // The editor still builds, with the quotes intact and no custom pairs.
        expect(config.typing?.transformations.extra).toHaveLength(2);
    });

    it("drops the quote replacements entirely when both are off", async () => {
        optionsState.map.textNoteDoubleQuoteStyle = "off";
        optionsState.map.textNoteSingleQuoteStyle = "off";

        const config = await buildConfig(baseOpts({ contentLanguage: "de" }));

        // Removed and not re-supplied, so a straight quote stays straight whatever the language.
        expect(config.typing?.transformations.remove).toEqual(["quotesPrimary", "quotesSecondary"]);
        expect(config.typing?.transformations.extra).toEqual([]);
    });

    it("lets a chosen style outrank the note's language", async () => {
        const quotesOf = (config: Awaited<ReturnType<typeof buildConfig>>) =>
            (config.typing?.transformations.extra ?? []).map((t) => (t as { to: string[] }).to);

        // The whole point of picking one: a note written in German still gets the chosen marks. This
        // is what serves someone writing several languages in a single note, whom no per-note
        // language setting can help.
        optionsState.map.textNoteDoubleQuoteStyle = "corner";
        optionsState.map.textNoteSingleQuoteStyle = "white-corner";
        expect(quotesOf(await buildConfig(baseOpts({ contentLanguage: "de" })))).toEqual([
            [null, "「", null, "」"],
            [null, "『", null, "』"]
        ]);

        // An id we do not know falls back to following the language rather than to no quotes.
        optionsState.map.textNoteDoubleQuoteStyle = "no-such-style";
        optionsState.map.textNoteSingleQuoteStyle = "no-such-style";
        expect(quotesOf(await buildConfig(baseOpts({ contentLanguage: "de" })))).toEqual([
            [null, "„", null, "“"],
            [null, "‚", null, "‘"]
        ]);
    });

    it("prefixes the emoji definitions URL with the page origin in dev mode", async () => {
        const prod = await buildConfig(baseOpts());
        window.glob.isDev = true;
        const dev = await buildConfig(baseOpts());

        const prodUrl = (prod.emoji as { definitionsUrl: string }).definitionsUrl;
        const devUrl = (dev.emoji as { definitionsUrl: string }).definitionsUrl;
        expect(typeof devUrl).toBe("string");
        // Dev mode prepends the origin, so the dev URL ends with the plain (prod) one.
        expect(devUrl.endsWith(prodUrl)).toBe(true);
        expect(devUrl.length).toBeGreaterThanOrEqual(prodUrl.length);
    });
});

describe("CK config - image actions", () => {
    it("adds the copy-image toolbar action only when raw image copy is supported", async () => {
        const unsupported = await buildConfig(baseOpts());
        const unsupportedToolbar = (unsupported.image as { toolbar: unknown[] }).toolbar;
        expect(unsupportedToolbar).not.toContain("copyImageToClipboard");
        expect(unsupportedToolbar).toContain("downloadImage");

        imageState.copySupported = true;
        const supported = await buildConfig(baseOpts());
        const supportedToolbar = (supported.image as { toolbar: unknown[] }).toolbar;
        expect(supportedToolbar).toContain("copyImageToClipboard");
        expect(supportedToolbar).toContain("downloadImage");
    });

    it("wires the shortcut renderer, copy and download callbacks to their services", async () => {
        const config = await buildDynamicConfig();

        // `renderShortcut` hands a plugin ready-made markup: every key translated through the app
        // catalog and wrapped in its own `<kbd>`. The platform is read per call, so both the
        // separated rendering and the macOS glyph one come from the same config entry.
        vi.stubGlobal("navigator", { platform: "Win32" });
        expect(config.renderShortcut("Ctrl+Enter"))
            .toBe("<kbd>keyboard_shortcut_keys.ctrl</kbd>+<kbd>keyboard_shortcut_keys.enter</kbd>");

        vi.stubGlobal("navigator", { platform: "MacIntel" });
        expect(config.renderShortcut("Ctrl+Enter")).toBe("<kbd>⌃</kbd><kbd>↩</kbd>");

        config.imageActions.copyToClipboard("image-src-1");
        config.imageActions.download("image-src-2");
        expect(imageService.copyImageToClipboard).toHaveBeenCalledWith("image-src-1");
        expect(imageService.downloadImage).toHaveBeenCalledWith("image-src-2");
    });

    // The option is read per call rather than baked into the config, so toggling it applies to
    // editors that are already open.
    it("re-reads the auto-link-preview option on every call", async () => {
        const config = await buildDynamicConfig();
        expect(config.autoLinkPreviewsEnabled()).toBe(false);

        optionsState.map["textNoteAutoLinkPreviewsEnabled"] = "true";
        expect(config.autoLinkPreviewsEnabled()).toBe(true);
    });
});

describe("CK config - lazy loaders", () => {
    it("lazy-loads KaTeX, Mermaid and highlight.js on demand", async () => {
        const config = await buildDynamicConfig();

        await config.math.lazyLoad();
        expect((window as unknown as { katex: unknown }).katex).toEqual({ name: "katex-stub" });

        const mermaid = await config.mermaid.lazyLoad();
        expect(mermaid).toEqual({ name: "mermaid-stub" });

        const hljs = await config.syntaxHighlighting.loadHighlightJs();
        expect(hljs.default).toEqual({ name: "hljs-stub" });
        expect(ensureMimeTypesForHighlighting).toHaveBeenCalled();
    });
});

describe("CK config - mention feed", () => {
    it("is omitted when note completion is disabled", async () => {
        const config = await buildDynamicConfig();
        expect(config.mention).toBeUndefined();
    });

    it("builds the @-mention feed and renders suggestions when note completion is enabled", async () => {
        optionsState.map["textNoteCompletionEnabled"] = "true";
        const config = await buildDynamicConfig();

        const feedConfig = config.mention?.feeds[0];
        if (!feedConfig) throw new Error("expected the mention feed to be configured");
        expect(feedConfig.marker).toBe("@");
        expect(feedConfig.minimumCharacters).toBe(0);

        await feedConfig.feed("query-text");
        expect(noteAutocompleteService.autocompleteSourceForCKEditor).toHaveBeenCalledWith("query-text");

        // A normal note suggestion keeps its own icon and renders its highlighted title.
        const noteItem = feedConfig.itemRenderer({ icon: "bx bx-folder", action: "open", highlightedNotePathTitle: "<b>Hello</b>" });
        expect(noteItem.tagName).toBe("BUTTON");
        expect((noteItem.firstChild as HTMLElement).className).toBe("bx bx-folder");
        expect(noteItem.querySelector("b")?.textContent).toBe("Hello");

        // The row is exactly the icon and a wrapped title: the stylesheet lays the two out against
        // each other, which it cannot do if the title is spread into the button as loose nodes.
        expect(noteItem.className).toBe("note-mention-suggestion");
        expect(noteItem.childNodes).toHaveLength(2);
        const title = noteItem.querySelector(".note-mention-suggestion-title");
        expect(title?.textContent).toBe("Hello");

        // A "create note" suggestion with no icon/title gets the plus icon and an empty title.
        const createItem = feedConfig.itemRenderer({ action: "create-note" });
        expect((createItem.firstChild as HTMLElement).className).toBe("bx bx-plus");
        expect(createItem.querySelector("b")).toBeNull();
    });
});

describe("CK config - AI assistant", () => {
    const PROVIDER = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5" }] }];

    // The two halves are settled together: without a transport the command can never be enabled,
    // so the button would only ever be there to be greyed out.
    it("offers the assistant only once the feature is on and a provider is configured", async () => {
        const off = await buildConfig(baseOpts());
        expect(off.aiAssistant?.stream).toBeUndefined();
        expect(toolbarItems(off)).not.toContain("aiAssistant");

        // The master switch off, but a provider still stored — what disabling it actually leaves.
        optionsState.json["llmProviders"] = PROVIDER;
        const noSwitch = await buildConfig(baseOpts());
        expect(noSwitch.aiAssistant?.stream).toBeUndefined();
        expect(toolbarItems(noSwitch)).not.toContain("aiAssistant");

        optionsState.map["aiEnabled"] = "true";
        const on = await buildConfig(baseOpts());
        expect(on.aiAssistant?.stream).toBeDefined();
        expect(toolbarItems(on)).toContain("aiAssistant");
    });
});

/** The built toolbar's own items, whichever of the two shapes CKEditor accepts it took. */
function toolbarItems(config: EditorConfig): unknown[] {
    return Array.isArray(config.toolbar) ? config.toolbar : (config.toolbar?.items ?? []);
}

describe("CK config - disabled plugins", () => {
    it("removes the emoji and slash-command plugins based on their option toggles", async () => {
        const disabled = await buildConfig(baseOpts());
        expect(disabled.removePlugins).toContain("TriliumEmojiMention");
        expect(disabled.removePlugins).toContain("TriliumSlashCommands");

        optionsState.map["textNoteEmojiCompletionEnabled"] = "true";
        optionsState.map["textNoteSlashCommandsEnabled"] = "true";
        const enabled = await buildConfig(baseOpts());
        expect(enabled.removePlugins).not.toContain("TriliumEmojiMention");
        expect(enabled.removePlugins).not.toContain("TriliumSlashCommands");
    });
});
