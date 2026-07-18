import { DISPLAYABLE_LOCALE_IDS, LOCALES } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../services/i18n.js";
import imageService from "../../../services/image.js";
import noteAutocompleteService from "../../../services/note_autocomplete.js";
import { ensureMimeTypesForHighlighting } from "../../../services/syntax_highlight.js";
import { buildConfig, type BuildEditorOptions, OPEN_SOURCE_LICENSE_KEY } from "./config.js";

// Mutable option values, reset before each test (see `beforeEach`).
const optionsState = vi.hoisted(() => ({ map: {} as Record<string, string | undefined> }));
// Toggles whether the editor advertises raw-image clipboard support.
const imageState = vi.hoisted(() => ({ copySupported: false }));

vi.mock("../../../services/options.js", () => ({
    default: {
        get(name: string) {
            if (name in optionsState.map) return optionsState.map[name];
            if (name === "allowedHtmlTags") return "[]";
            return undefined;
        },
        getJson(name: string) {
            if (name === "codeNotesMimeTypes") {
                return ["text/javascript", "application/javascript;env=frontend", "application/javascript;env=backend", "text/css"];
            }
            return [];
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
        forceGplLicense: false,
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
    translate(key: string, params?: Record<string, unknown>): unknown;
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
    imageState.copySupported = false;
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
                expect(config.translations, locale.id).toHaveLength(2);
            }
        }
    }, 20_000);

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

describe("CK config - licensing", () => {
    it("forces the open-source license and omits premium plugins when GPL is requested", async () => {
        const config = await buildConfig(baseOpts({ forceGplLicense: true }));

        expect(config.licenseKey).toBe(OPEN_SOURCE_LICENSE_KEY);
        expect(config.extraPlugins).toBeUndefined();
    });

    it("falls back to the open-source license and logs when no premium key is configured", async () => {
        vi.stubEnv("VITE_CKEDITOR_KEY", "");
        const logError = vi.fn();
        vi.stubGlobal("logError", logError);

        const config = await buildConfig(baseOpts({ forceGplLicense: false }));

        expect(config.licenseKey).toBe(OPEN_SOURCE_LICENSE_KEY);
        expect(config.extraPlugins).toBeUndefined();
        expect(logError).toHaveBeenCalledOnce();
    });

    it("enables premium plugins when a license key is available", async () => {
        // The dev key from `.env` is present in tests, so premium features are unlocked.
        const config = await buildConfig(baseOpts({ forceGplLicense: false }));

        expect(config.licenseKey).not.toBe(OPEN_SOURCE_LICENSE_KEY);
        expect(Array.isArray(config.extraPlugins)).toBe(true);
        expect((config.extraPlugins ?? []).length).toBeGreaterThan(0);
    });
});

describe("CK config - language & emoji", () => {
    it("omits the content-language override when no content language is given", async () => {
        const config = await buildConfig(baseOpts({ uiLanguage: "en", contentLanguage: null }));

        // With no content language the `language` override is skipped entirely; "en" has no CK locale mapping.
        expect(config.language).toBeUndefined();
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

    it("wires the translate, copy and download callbacks to their services", async () => {
        const config = await buildDynamicConfig();

        // `translate` simply delegates to the app's i18n function.
        expect(config.translate("editable_text.placeholder")).toBe(t("editable_text.placeholder"));

        config.imageActions.copyToClipboard("image-src-1");
        config.imageActions.download("image-src-2");
        expect(imageService.copyImageToClipboard).toHaveBeenCalledWith("image-src-1");
        expect(imageService.downloadImage).toHaveBeenCalledWith("image-src-2");
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

        // A "create note" suggestion with no icon/title gets the plus icon and an empty title.
        const createItem = feedConfig.itemRenderer({ action: "create-note" });
        expect((createItem.firstChild as HTMLElement).className).toBe("bx bx-plus");
        expect(createItem.querySelector("b")).toBeNull();
    });
});

describe("CK config - disabled plugins", () => {
    it("removes the emoji and slash-command plugins based on their option toggles", async () => {
        const disabled = await buildConfig(baseOpts());
        expect(disabled.removePlugins).toContain("EmojiMention");
        expect(disabled.removePlugins).toContain("SlashCommand");

        optionsState.map["textNoteEmojiCompletionEnabled"] = "true";
        optionsState.map["textNoteSlashCommandsEnabled"] = "true";
        const enabled = await buildConfig(baseOpts());
        expect(enabled.removePlugins).not.toContain("EmojiMention");
        expect(enabled.removePlugins).not.toContain("SlashCommand");
    });
});
