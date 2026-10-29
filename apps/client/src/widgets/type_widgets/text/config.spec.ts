import {
    BlockReferenceEditing, type EditorConfig, type InlineEmbedSource, InlineIconEditing,
    LinkEmbedEditing
} from "@triliumnext/ckeditor5";
import emojiDefinitionsUrl from "@triliumnext/ckeditor5/src/emoji_definitions/en.json?url";
import { DISPLAYABLE_LOCALE_IDS, IMAGE_MIMES, LOCALES, SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import imageService from "../../../services/image.js";
import linkService from "../../../services/link.js";
import { ensureMimeTypesForHighlighting } from "../../../services/syntax_highlight.js";
import type { AddLinkOpts } from "../../dialogs/add_link.js";
import {
    buildConfig, type BuildEditorOptions, OPEN_SOURCE_LICENSE_KEY, SHARE_EDIT_DISABLED_PLUGINS,
    SHARE_EDIT_UPLOAD_PLUGINS
} from "./config.js";

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
// `isShare` is settled when the module loads, so a shared page's editing is stubbed instead.
const shareState = vi.hoisted(() => ({ editing: false }));
vi.mock("../../../services/utils.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils.js")>()),
    isShareEditing: () => shareState.editing
}));

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string) => catalogState.entries[key] ?? key,
    // Read while the AI assistant's Translate submenu is built, which every config goes through.
    getAvailableLocales: () => [],
    // Awaited by `command_registry.ts` as it loads, through the `@` list's note autocomplete.
    translationsInitializedPromise: Promise.resolve()
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

const experimentalState = vi.hoisted(() => ({ enabled: new Set<string>() }));
vi.mock("../../../services/experimental_features.js", () => ({
    isExperimentalFeatureEnabled: (id: string) => experimentalState.enabled.has(id)
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

// Keep the real module, but skip the actual theme/mime loading the lazy loader would trigger.
vi.mock("../../../services/syntax_highlight.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/syntax_highlight.js")>()),
    ensureMimeTypesForHighlighting: vi.fn(async () => {})
}));

// Heavy modules pulled in lazily by the editor config — replace with light stubs.
const promptState = vi.hoisted(() => ({ answer: null as string | null, seen: [] as unknown[] }));
vi.mock("../../../services/dialog.js", () => ({
    prompt: vi.fn(async (props: unknown) => {
        promptState.seen.push(props);
        return promptState.answer;
    })
}));
vi.mock("@triliumnext/highlightjs", () => ({ default: { name: "hljs-stub" } }));
vi.mock("../../../services/math.js", () => ({ default: { name: "katex-stub" } }));
vi.mock("../../../services/content_renderer.js", () => ({ getUploadBoxSize: vi.fn(() => "medium") }));
const { convertImageToDrawing } = vi.hoisted(() => ({
    convertImageToDrawing: vi.fn(async () => "d1")
}));
vi.mock("../canvas/image_to_drawing.js", () => ({ convertImageToDrawing }));
vi.mock("../../../services/server.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../../services/server.js")>();
    return {
        default: {
            ...original.default,
            // `keyboard_actions` loads its actions through `get` on import.
            get: vi.fn(async () => []),
            getHeaders: vi.fn(async (headers?: Record<string, string | null | undefined>) => ({
                "x-csrf-token": "csrf",
                "trilium-hoisted-note-id": null,
                ...headers
            }))
        }
    };
});
vi.mock("../../../services/link_embed.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/link_embed.js")>()),
    fetchMetadata: vi.fn(async (url: string, ownerNoteId: string) => ({ url, embedType: "opengraph", title: ownerNoteId }))
}));

function baseOpts(overrides: Partial<BuildEditorOptions> = {}): BuildEditorOptions {
    return {
        uiLanguage: "en",
        contentLanguage: "en",
        isClassicEditor: false,
        templates: [],
        ...overrides
    };
}

/** The dynamically-attached config members that CKEditor's `EditorConfig` type doesn't declare. */
interface DynamicConfig {
    renderShortcut(shortcut: string): string;
    autoLinkPreviewsEnabled(): boolean;
    imageActions: {
        copyToClipboard(src: string): void;
        download(src: string): void;
    };
    math: { enableMathField: boolean; lazyLoad(): Promise<void> };
    contentEmbed: { inlineLanguages: string[] };
    syntaxHighlighting: { loadHighlightJs(): Promise<{ default: unknown }> };
    mention?: {
        feeds: unknown[];
        hostedFeeds?: { marker: string; minimumCharacters?: number; allowSpaces?: boolean; list(): unknown }[];
    };
}

async function buildDynamicConfig(overrides: Partial<BuildEditorOptions> = {}) {
    return await buildConfig(baseOpts(overrides)) as unknown as DynamicConfig;
}

beforeEach(() => {
    optionsState.map = {};
    optionsState.json = {};
    experimentalState.enabled.clear();
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

    // With "auto", a pasted image goes inline in a list item or after text, and on its own line in an
    // empty paragraph; CKEditor's fallback inserts every image as a block.
    it("inserts images inline or as a block depending on where the cursor is", async () => {
        const config = await buildConfig(baseOpts());
        expect((config.image as { insert?: { type?: string } }).insert?.type).toBe("auto");
    });

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

describe("CK config - tables", () => {
    it("keeps the column bar above the phone's toolbar while it is shown", async () => {
        const bottomObstacle = (await buildConfig(baseOpts())).tableColumnBar?.bottomObstacle;
        expect(bottomObstacle?.()).toBeNull();

        const container = document.createElement("div");
        container.className = "classic-toolbar-outer-container visible active";
        const island = document.createElement("div");
        island.className = "classic-toolbar-island";
        container.appendChild(island);
        document.body.appendChild(container);
        expect(bottomObstacle?.()).toBe(island);

        container.classList.remove("active");
        expect(bottomObstacle?.()).toBeNull();
        container.remove();
    });

    it("offers the Sort dropdown just before the table properties", async () => {
        const toolbar = (await buildConfig(baseOpts())).table?.contentToolbar ?? [];
        expect(toolbar).toContain("tableSort");
        expect(toolbar.indexOf("tableSort")).toBe(toolbar.indexOf("tableProperties") - 1);
    });

    it("hands the user's date format to table sorting", async () => {
        expect((await buildConfig(baseOpts())).autoSort).toEqual({ dateFormats: [] });

        optionsState.map.customDateTimeFormat = "DD.MM.YYYY HH:mm";
        expect((await buildConfig(baseOpts())).autoSort)
            .toEqual({ dateFormats: ["DD.MM.YYYY HH:mm"] });
    });

    it("formats inserted dates in a chosen format or the user's current one", async () => {
        const { formatDateTime } = await buildConfig(baseOpts());
        const date = new Date(2026, 8, 25, 10, 30);

        expect(formatDateTime?.(date, "YYYY")).toBe("2026");

        optionsState.map.customDateTimeFormat = "DD.MM.YYYY HH:mm";
        expect(formatDateTime?.(date)).toBe("25.09.2026 10:30");
    });

    it("fetches link previews for the open note, and none without one", async () => {
        let noteId: string | undefined = "noteAbc";
        const linkEmbed = (await buildConfig(baseOpts({ getNoteId: () => noteId }))).linkEmbed;

        expect(await linkEmbed?.fetchMetadata?.("https://a.example/"))
            .toStrictEqual({ url: "https://a.example/", embedType: "opengraph", title: "noteAbc" });

        noteId = undefined;
        expect(await linkEmbed?.fetchMetadata?.("https://a.example/")).toMatchObject({ unresolved: true });
        expect(linkEmbed?.detectEmbedType?.("https://youtube.com/watch?v=abc12345678")).toBe("youtube");
    });

    it("uploads to the open note, as a change of the editor's component", async () => {
        const config = await buildConfig(baseOpts({ getNoteId: () => "noteAbc", getComponentId: () => "editor1" }));

        expect(config.getNoteId?.()).toBe("noteAbc");
        // Headers without a value are left out rather than sent as the text "null".
        expect(await config.attachmentUpload?.getHeaders?.())
            .toStrictEqual({ "x-csrf-token": "csrf", "trilium-component-id": "editor1" });
        expect(config.attachmentUpload?.getEmbedBoxSize?.("image/png", 1)).toBe("medium");
    });

    it("hands the dialogs and cut to note of the editor to the app commands that do them", async () => {
        const triggerHostCommand = vi.fn(async () => undefined);
        const config = await buildConfig(baseOpts({ triggerHostCommand }));
        const callbacks = [
            [ config.internalLink?.openDialog, "addLinkToText" ],
            [ config.markdownImport?.open, "pasteMarkdownIntoText" ],
            [ config.contentEmbed?.pickNote, "addIncludeNoteToText" ],
            [ config.cutToNote?.cut, "cutIntoNote" ],
            [ config.cutToNote?.saveNow, "saveNoteDetailNow" ]
        ] as const;

        for (const [ callback, command ] of callbacks) {
            await callback?.();
            expect(triggerHostCommand).toHaveBeenLastCalledWith(command);
        }
        expect(triggerHostCommand).toHaveBeenCalledTimes(callbacks.length);
    });

    it("shows the icon picker the editor asks for, and none without a host for it", async () => {
        const release = vi.fn();
        const showIconPicker = vi.fn(() => release);
        const request = { container: document.createElement("div"), onSelect: vi.fn() };

        expect((await buildConfig(baseOpts({ showIconPicker }))).inlineIcon?.showPicker(request)).toBe(release);
        expect(showIconPicker).toHaveBeenCalledWith(request);
        expect((await buildConfig(baseOpts())).inlineIcon?.showPicker(request)).toBeNull();
    });

    it("copies block and tab references from the reference source, and none without one", async () => {
        const getEditor = vi.fn(() => null);
        const referenceSource = {
            getEditor, getNote: () => null, getNotePath: () => undefined, save: vi.fn()
        };
        const config = await buildConfig(baseOpts({ referenceSource }));

        config.blockReference?.copyReference?.();
        config.tabs?.copyReference?.();

        expect(getEditor).toHaveBeenCalledTimes(2);
        const bare = await buildConfig(baseOpts());
        expect(bare.blockReference).toBeUndefined();
        expect(bare.tabs).toBeUndefined();
    });

    it("converts images to drawings in the note open at the time, as changes of the host", async () => {
        let noteId: string | undefined = "n1";
        const config = await buildConfig(baseOpts({
            getNoteId: () => noteId,
            getComponentId: () => "component1"
        }));

        expect(await config.imageToDrawing?.convert?.("api/images/a.png")).toBe("d1");
        noteId = undefined;
        expect(await config.imageToDrawing?.convert?.("api/images/b.png")).toBeNull();

        expect(convertImageToDrawing).toHaveBeenCalledExactlyOnceWith("n1", "api/images/a.png", "component1");
    });

    it("hands embeds to the content embed handlers of the moment, and falls back without any", async () => {
        const tools = { getTools: () => [], execute: vi.fn(), subscribe: () => () => {} };
        const first = {
            loadNote: vi.fn(),
            loadAttachment: vi.fn(),
            loadInline: vi.fn(),
            flushInline: vi.fn(),
            focusAttachment: vi.fn(),
            getAttachmentHref: vi.fn(async () => "#root/n1?viewMode=attachments&attachmentId=a1"),
            openMenu: vi.fn(),
            getTools: vi.fn(() => tools),
            enter: vi.fn(() => true)
        };
        const second = { ...first, loadNote: vi.fn() };
        let handlers: typeof first | undefined = first;
        const embed = document.createElement("figure");
        const wrapper = document.createElement("div");
        const source = {} as InlineEmbedSource;
        const onBlockChange = vi.fn();
        const host = (await buildConfig(baseOpts({ getContentEmbedHandlers: () => handlers })))
            .contentEmbed;

        host?.loadNote?.("n1", wrapper, "small", "b1", onBlockChange);
        handlers = second;
        host?.loadNote?.("n2", wrapper, undefined, undefined, onBlockChange);
        host?.loadAttachment?.("a1", wrapper, "medium");
        host?.loadInline?.(source, wrapper, "full", { isFocused: true });
        host?.flushInline?.();
        host?.focusAttachment?.("a1");
        host?.openMenu?.(embed, wrapper);

        expect(first.loadNote).toHaveBeenCalledExactlyOnceWith("n1", wrapper, "small", "b1", onBlockChange);
        expect(second.loadNote).toHaveBeenCalledExactlyOnceWith("n2", wrapper, undefined, undefined, onBlockChange);
        expect(first.loadAttachment).toHaveBeenCalledWith("a1", wrapper, "medium");
        expect(first.loadInline).toHaveBeenCalledWith(source, wrapper, "full", { isFocused: true });
        expect(first.flushInline).toHaveBeenCalledOnce();
        expect(first.focusAttachment).toHaveBeenCalledWith("a1");
        expect(first.openMenu).toHaveBeenCalledWith(embed, wrapper);
        expect(await host?.getAttachmentHref?.("a1")).toBe("#root/n1?viewMode=attachments&attachmentId=a1");
        expect(host?.getTools?.(embed)).toBe(tools);
        expect(host?.enter?.(embed, "end")).toBe(true);
        expect(first.enter).toHaveBeenCalledWith(embed, "end");

        handlers = undefined;
        expect(await host?.getAttachmentHref?.("a1")).toBeNull();
        expect(host?.getTools?.(embed)).toBeNull();
        expect(host?.enter?.(embed, "start")).toBe(false);
        expect(() => host?.loadNote?.("n1", wrapper, undefined, undefined, onBlockChange)).not.toThrow();
        expect(() => host?.flushInline?.()).not.toThrow();
    });

    it("titles reference links through the link service, in the note open at the time", async () => {
        const loadTitle = vi.spyOn(linkService, "loadReferenceLinkTitle").mockResolvedValue();
        onTestFinished(() => loadTitle.mockRestore());
        let noteId = "n1";
        const referenceLink = (await buildConfig(baseOpts({ getNoteId: () => noteId }))).referenceLink;
        const element = document.createElement("span");

        referenceLink?.renderTitle?.(element, "#root/n2", "Stored");
        noteId = "n3";
        referenceLink?.renderTitle?.(element, "#root/n2");

        expect(referenceLink?.getTitle).toBe(linkService.getReferenceLinkTitle);
        expect(referenceLink?.getTitleSync).toBe(linkService.getReferenceLinkTitleSync);
        expect(loadTitle.mock.calls.map(([ $el, ...rest ]) => [ $el[0], ...rest ])).toEqual([
            [ element, "#root/n2", "n1", "Stored" ],
            [ element, "#root/n2", "n3", undefined ]
        ]);
    });

    it("asks the host to fix a link to a missing note through the add link dialog", async () => {
        const triggerHostCommand = vi.fn(async () => undefined);
        const fix = vi.fn();
        const referenceLink = (await buildConfig(baseOpts({ triggerHostCommand }))).referenceLink;

        referenceLink?.fixLink?.("Gone", fix);

        expect(triggerHostCommand).toHaveBeenCalledExactlyOnceWith("showAddLinkDialog", expect.objectContaining({
            text: "Gone", hasSelection: false, fixLink: true
        }));
        const [ , dialog ] = triggerHostCommand.mock.calls[0] as unknown as [ string, AddLinkOpts ];
        await dialog.addLink("root/n9", null);
        expect(fix).toHaveBeenCalledExactlyOnceWith("#root/n9");
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

    it("names the emoji definitions by an absolute URL, from the page's base", async () => {
        const config = await buildConfig(baseOpts());
        const { definitionsUrl } = config.emoji as { definitionsUrl: string };

        expect(() => new URL(definitionsUrl)).not.toThrow();
        expect(definitionsUrl).toBe(new URL(emojiDefinitionsUrl, document.baseURI).href);
    });
});

describe("CK config - list start", () => {
    it("asks for the number in the app's prompt, keeping only a whole number of 0 or more", async () => {
        const config = await buildConfig(baseOpts());
        const ask = config.listStartPrompt;
        if (!ask) throw new Error("expected listStartPrompt");

        promptState.answer = " 12 ";
        expect(await ask("Start at", 3)).toBe(12);
        expect(promptState.seen.at(-1)).toMatchObject({ title: "Start at", defaultValue: "3" });

        for (const answer of [ null, "", "abc", "-1", "2.5" ]) {
            promptState.answer = answer;
            expect(await ask("Start at", 3)).toBeNull();
        }
        promptState.answer = "0";
        expect(await ask("Start at", 3)).toBe(0);
    });
});

describe("CK config - image actions", () => {
    it("places the image in one position menu, in place of the style buttons", async () => {
        const toolbar = ((await buildConfig(baseOpts())).image as { toolbar: unknown[] }).toolbar;
        expect(toolbar[0]).toBe("imagePosition");
        expect(JSON.stringify(toolbar)).not.toContain("imageStyle:");
    });

    it("adds the copy-image toolbar action only when raw image copy is supported", async () => {
        const unsupported = await buildConfig(baseOpts());
        const unsupportedToolbar = (unsupported.image as { toolbar: unknown[] }).toolbar;
        expect(unsupportedToolbar).not.toContain("copyImageToClipboard");
        expect(unsupportedToolbar).toContain("downloadImage");
        expect(unsupportedToolbar).toContain("convertImageToDrawing");

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
    it("lazy-loads KaTeX and highlight.js on demand", async () => {
        const config = await buildDynamicConfig();

        await config.math.lazyLoad();
        expect((window as unknown as { katex: unknown }).katex).toEqual({ name: "katex-stub" });

        const hljs = await config.syntaxHighlighting.loadHighlightJs();
        expect(hljs.default).toEqual({ name: "hljs-stub" });
        expect(ensureMimeTypesForHighlighting).toHaveBeenCalled();
    });
});

describe("CK config - inline embeds", () => {
    it("keeps the source of every source embed type inline, as a code block of its language", async () => {
        const config = await buildDynamicConfig();
        expect(config.contentEmbed.inlineLanguages).toEqual([ "mermaid" ]);
    });

    it("offers the slash command of extended code blocks while their feature is on", async () => {
        const getRemoved = async () =>
            (await buildConfig(baseOpts())).slashCommand?.removeCommands ?? [];

        expect(await getRemoved()).toContain("extended-code-block");
        experimentalState.enabled.add("extendedCodeBlocks");
        expect(await getRemoved()).not.toContain("extended-code-block");
        expect(await getRemoved()).toEqual([ "bulletedList", "numberedList" ]);
    });
});

describe("CK config - mention feed", () => {
    it("lists notes after @ as the note autocomplete does, only when note completion is enabled", async () => {
        const off = await buildDynamicConfig();
        expect(off.mention?.feeds).toEqual([]);
        expect(off.mention?.hostedFeeds).toEqual([]);

        optionsState.map["textNoteCompletionEnabled"] = "true";
        const config = await buildDynamicConfig();
        const hosted = config.mention?.hostedFeeds?.[0];
        expect(hosted).toMatchObject({ marker: "@", minimumCharacters: 0, allowSpaces: true });
        expect(hosted?.list()).toEqual(expect.objectContaining({ show: expect.any(Function), handleKeyDown: expect.any(Function) }));
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
    it("passes the MathLive option to the math editor", async () => {
        const defaultConfig = await buildDynamicConfig();
        expect(defaultConfig.math.enableMathField).toBe(true);

        optionsState.map["mathFieldEnabled"] = "false";
        const disabledConfig = await buildDynamicConfig();
        expect(disabledConfig.math.enableMathField).toBe(false);
    });

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

    it("removes what reaches beyond a shared note from its editor, and uploads", async () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        try {
            shareState.editing = true;
            glob.shareEdit = { version: "blob1", attachments: false };
            const locked = await buildConfig(baseOpts());
            expect(locked.removePlugins).toEqual(expect.arrayContaining([
                ...SHARE_EDIT_DISABLED_PLUGINS, ...SHARE_EDIT_UPLOAD_PLUGINS
            ]));
            // Link previews fetch their metadata through the host's server; the note's existing
            // previews, block ids and icons still need the schema and converters that keep them
            // through a save.
            expect(locked.removePlugins)
                .toEqual(expect.arrayContaining([ "LinkEmbed", "LinkEmbedToolbar" ]));
            expect(locked.extraPlugins)
                .toEqual([ LinkEmbedEditing, BlockReferenceEditing, InlineIconEditing ]);
            expect(locked.link?.toolbar).not.toContain("linkEmbedDisplayDropdown");

            glob.shareEdit = { version: "blob1", attachments: true };
            const uploading = await buildConfig(baseOpts());
            expect(uploading.removePlugins)
                .toEqual(expect.arrayContaining(SHARE_EDIT_DISABLED_PLUGINS));
            expect(uploading.removePlugins).not.toContain("UploadimagePlugin");

            shareState.editing = false;
            delete glob.shareEdit;
            const plain = await buildConfig(baseOpts());
            expect(plain.removePlugins).not.toContain("CutToNotePlugin");
            expect(plain.extraPlugins).toBeUndefined();
            expect(plain.link?.toolbar).toContain("linkEmbedDisplayDropdown");
        } finally {
            shareState.editing = false;
            delete glob.shareEdit;
        }
    });

    it("hands the toolbar's group menus and the color menu to the app's own menu", async () => {
        const config = await buildConfig(baseOpts());
        const editor = {} as Parameters<NonNullable<typeof config.colorMenu>["host"]>[0];
        for (const host of [ config.toolbarGroupMenu?.host(editor), config.colorMenu?.host(editor) ]) {
            expect(host).toMatchObject({ show: expect.any(Function), hide: expect.any(Function) });
            host?.destroy();
        }
    });

    it("removes the block drag handle in the mobile layout", async () => {
        const originalDevice = window.glob.device;
        try {
            window.glob.device = "desktop";
            expect((await buildConfig(baseOpts())).removePlugins).not.toContain("BlockDragHandle");

            window.glob.device = "mobile";
            expect((await buildConfig(baseOpts())).removePlugins).toContain("BlockDragHandle");
        } finally {
            window.glob.device = originalDevice;
        }
    });

    it("leaves out the content hints in the mobile layout, whatever their option", async () => {
        const originalDevice = window.glob.device;
        const contentHints = async () => (await buildConfig(baseOpts()) as { contentHintsEnabled?: boolean })
            .contentHintsEnabled;
        optionsState.map["textNoteContentHintsEnabled"] = "true";
        try {
            window.glob.device = "desktop";
            expect(await contentHints()).toBe(true);

            window.glob.device = "mobile";
            expect(await contentHints()).toBe(false);
        } finally {
            window.glob.device = originalDevice;
        }
    });
});
