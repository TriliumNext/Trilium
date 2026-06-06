import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable control state shared by the hoisted mock factories below.
// `vi.hoisted` runs before the hoisted `vi.mock` factories, so they may read it.
const ctrl = vi.hoisted(() => ({
    isShare: false,
    // highlight.js stubs are reset per test by reassigning these fns.
}));

// Partial-mock ./utils so we can flip `isShare` (a const in the target, read
// here through a live getter at call time) while keeping the rest of the real
// module intact (options.ts also imports `isShare` from here).
vi.mock("./utils.js", async (orig) => {
    const actual = (await orig()) as Record<string, unknown>;
    return {
        ...actual,
        get isShare() {
            return ctrl.isShare;
        }
    };
});

// Stub the heavy highlight.js bundle. The real implementation dynamically
// imports CSS-as-raw and language modules, which don't resolve under vitest and
// are not the unit under test. We assert the orchestration logic instead.
const hl = vi.hoisted(() => ({
    ensureMimeTypes: vi.fn(async (_types: unknown) => {}),
    loadTheme: vi.fn(async (_theme: unknown) => {}),
    highlight: vi.fn((_text: string, _opts: { language: string }) => ({ value: "HL" }) as { value: string } | null),
    highlightAuto: vi.fn((_text: string) => ({ value: "AUTO" }) as { value: string } | null)
}));

vi.mock("@triliumnext/highlightjs", () => {
    const Themes = {
        default: { name: "Original (Light)", load: async () => ({ default: "" }) },
        vs: { name: "Visual Studio (Light)", load: async () => ({ default: "" }) },
        agate: { name: "Agate (Dark)", load: async () => ({ default: "" }) }
    };
    return {
        Themes,
        ensureMimeTypes: (t: unknown) => hl.ensureMimeTypes(t),
        loadTheme: (t: unknown) => hl.loadTheme(t),
        highlight: (text: string, opts: { language: string }) => hl.highlight(text, opts),
        highlightAuto: (text: string) => hl.highlightAuto(text)
    };
});

// Spy on the clipboard helpers so we can assert which copy path the click handlers take
// (copyTextWithToast in-app vs copyText in share mode). Persists across vi.resetModules().
const clip = vi.hoisted(() => ({
    copyText: vi.fn(),
    copyTextWithToast: vi.fn()
}));
vi.mock("./clipboard_ext.js", () => ({
    copyText: (t: string) => clip.copyText(t),
    copyTextWithToast: (t: string) => clip.copyTextWithToast(t)
}));

// Imports AFTER the vi.mock calls (which are hoisted above imports anyway).
import type OptionsType from "./options.js";

type SyntaxHighlightModule = typeof import("./syntax_highlight.js");

// The fresh module copy binds to a fresh `options` singleton; we must drive THAT
// instance, so freshModule returns it alongside the syntax-highlight module.
let currentOptions: typeof OptionsType;

/**
 * Each scenario uses a fresh module copy so the module-level `highlightingLoaded`
 * and `colorSchemeListenerRegistered` flags + the highlight cache start clean.
 */
async function freshModule(): Promise<SyntaxHighlightModule> {
    vi.resetModules();
    currentOptions = (await import("./options.js")).default;
    return (await import("./syntax_highlight.js")) as SyntaxHighlightModule;
}

function setOptions(values: Record<string, string>) {
    currentOptions.load(values);
}

// formatCodeBlocks fires applySingleBlockSyntaxHighlight without awaiting it, so
// the (async) highlight completes on later microtasks. Flush a few rounds.
async function flush() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

function $codeBlock(html: string, lang?: string) {
    const $pre = $("<pre>");
    const $code = $("<code>").text(html);
    if (lang) {
        $code.addClass(`language-${lang}`);
    }
    $pre.append($code);
    $("<div>").append($pre); // give the <pre> a parent for button append
    return $code;
}

describe("syntax_highlight", () => {
    beforeEach(() => {
        ctrl.isShare = false;
        (window as any).glob = { isMainWindow: true }; // device is undefined (not "print")
        hl.ensureMimeTypes.mockClear().mockImplementation(async () => {});
        hl.loadTheme.mockClear().mockImplementation(async () => {});
        hl.highlight.mockClear().mockImplementation(() => ({ value: "HL" }));
        hl.highlightAuto.mockClear().mockImplementation(() => ({ value: "AUTO" }));
        // matchMedia is required by the color-scheme listener.
        (window as any).matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        }));
    });

    describe("isSyntaxHighlightEnabled / getEffectiveCodeBlockTheme", () => {
        it("uses codeBlockTheme when not matching the app, treating empty/none as disabled", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            expect(mod.isSyntaxHighlightEnabled()).toBe(true);

            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "none" });
            expect(mod.isSyntaxHighlightEnabled()).toBe(false);

            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "" });
            expect(mod.isSyntaxHighlightEnabled()).toBe(false);
        });

        it("uses the dark/light theme option when matching the app appearance", async () => {
            const mod = await freshModule();
            setOptions({
                codeBlockThemeMatchesApp: "true",
                codeBlockThemeDark: "default:agate",
                codeBlockThemeLight: "default:vs"
            });

            // dark
            (window as any).matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn() }));
            (window as any).glob = { isMainWindow: true, theme: "auto" };
            expect(mod.isSyntaxHighlightEnabled()).toBe(true);

            // light
            (window as any).matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn() }));
            expect(mod.isSyntaxHighlightEnabled()).toBe(true);
        });

        it("is always enabled in share mode (isShare branch)", async () => {
            const mod = await freshModule();
            ctrl.isShare = true;
            expect(mod.isSyntaxHighlightEnabled()).toBe(true);
        });
    });

    describe("loadHighlightingTheme", () => {
        it("uses the vs theme when printing", async () => {
            const mod = await freshModule();
            (window as any).glob = { device: "print" };
            await mod.loadHighlightingTheme("default:agate");
            expect(hl.loadTheme).toHaveBeenCalledWith(expect.objectContaining({ name: "Visual Studio (Light)" }));
        });

        it("resolves a default-prefixed theme name", async () => {
            const mod = await freshModule();
            await mod.loadHighlightingTheme("default:agate");
            expect(hl.loadTheme).toHaveBeenCalledWith(expect.objectContaining({ name: "Agate (Dark)" }));
        });

        it("falls back to the default theme when name is unprefixed", async () => {
            const mod = await freshModule();
            await mod.loadHighlightingTheme("unknown-theme");
            expect(hl.loadTheme).toHaveBeenCalledWith(expect.objectContaining({ name: "Original (Light)" }));
        });
    });

    describe("ensureMimeTypesForHighlighting", () => {
        it("loads theme + all mime types on first call, then short-circuits", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs", codeNotesMimeTypes: "[]" });

            await mod.ensureMimeTypesForHighlighting();
            expect(hl.loadTheme).toHaveBeenCalledTimes(1);
            // getMimeTypes() returns the full dictionary (an array).
            expect(Array.isArray(hl.ensureMimeTypes.mock.calls[0][0])).toBe(true);

            // second call with no hint and highlightingLoaded -> early return
            await mod.ensureMimeTypesForHighlighting();
            expect(hl.loadTheme).toHaveBeenCalledTimes(1);
            expect(hl.ensureMimeTypes).toHaveBeenCalledTimes(1);
        });

        it("passes a single synthesized mime type when given a hint", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });

            await mod.ensureMimeTypesForHighlighting("text-css");
            expect(hl.ensureMimeTypes).toHaveBeenCalledWith([
                { title: "text-css", enabled: true, mime: "text/css" }
            ]);
            // a hint always proceeds past the early return even when already loaded
            await mod.ensureMimeTypesForHighlighting("text-x-csrc");
            expect(hl.ensureMimeTypes).toHaveBeenLastCalledWith([
                { title: "text-x-csrc", enabled: true, mime: "text/x-csrc" }
            ]);
        });
    });

    describe("applySingleBlockSyntaxHighlight", () => {
        it("highlights a specific language and caches the result", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            const $a = $codeBlock("const x = 1;", "text-css");
            await mod.applySingleBlockSyntaxHighlight($a, "text-css");
            expect($a.html()).toBe("HL");
            expect($a.parent().hasClass("hljs")).toBe(true);

            // second block, same (language, text) -> served from cache, no re-highlight
            hl.highlight.mockClear();
            const $b = $codeBlock("const x = 1;", "text-css");
            await mod.applySingleBlockSyntaxHighlight($b, "text-css");
            expect($b.html()).toBe("HL");
            expect(hl.highlight).not.toHaveBeenCalled();
        });

        it("uses highlightAuto for the auto mime type when not in share mode", async () => {
            const mod = await freshModule();
            const $a = $codeBlock("auto code", "text-x-trilium-auto");
            await mod.applySingleBlockSyntaxHighlight($a, "text-x-trilium-auto");
            expect(hl.highlightAuto).toHaveBeenCalledWith("auto code");
            expect($a.html()).toBe("AUTO");
        });

        it("swallows highlight errors and leaves content untouched", async () => {
            const mod = await freshModule();
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            hl.highlight.mockImplementation(() => {
                throw new Error("boom");
            });
            const $a = $codeBlock("broken", "text-x-csrc");
            await mod.applySingleBlockSyntaxHighlight($a, "text-x-csrc");
            expect(warn).toHaveBeenCalled();
            expect($a.html()).toBe("broken"); // unchanged, nothing cached/applied
        });

        it("does nothing extra when highlight returns null", async () => {
            const mod = await freshModule();
            hl.highlight.mockImplementation(() => null);
            const $a = $codeBlock("noresult", "text-x-csrc");
            await mod.applySingleBlockSyntaxHighlight($a, "text-x-csrc");
            expect($a.html()).toBe("noresult");
        });

        it("does not highlight when the mime type is empty", async () => {
            const mod = await freshModule();
            const $a = $codeBlock("nolang");
            await mod.applySingleBlockSyntaxHighlight($a, "");
            expect(hl.highlight).not.toHaveBeenCalled();
            expect(hl.highlightAuto).not.toHaveBeenCalled();
            expect($a.html()).toBe("nolang");
        });
    });

    describe("copy buttons", () => {
        it("appends a copy button that copies via toast when not in share mode", async () => {
            clip.copyText.mockClear();
            clip.copyTextWithToast.mockClear();
            const mod = await freshModule();
            const $code = $codeBlock("copy me");
            mod.applyCopyToClipboardButton($code);
            const $btn = $code.parent().find("button.copy-button");
            expect($btn.length).toBe(1);

            // Non-share path: the click copies the code block's text via the toast helper.
            $btn.trigger("click");
            expect(clip.copyTextWithToast).toHaveBeenCalledWith("copy me");
            expect(clip.copyText).not.toHaveBeenCalled();
        });

        it("copy button uses the plain copy path in share mode", async () => {
            clip.copyText.mockClear();
            clip.copyTextWithToast.mockClear();
            const mod = await freshModule();
            ctrl.isShare = true;
            const $code = $codeBlock("share copy");
            mod.applyCopyToClipboardButton($code);
            $code.parent().find("button.copy-button").trigger("click");

            // Share path: plain copyText, no toast.
            expect(clip.copyText).toHaveBeenCalledWith("share copy");
            expect(clip.copyTextWithToast).not.toHaveBeenCalled();
        });

        it("inline code copy adds class + handler for both share and non-share", async () => {
            clip.copyText.mockClear();
            clip.copyTextWithToast.mockClear();
            const mod = await freshModule();
            const $inline = $("<code>").text("inline");
            mod.applyInlineCodeCopy($inline);
            expect($inline.hasClass("copyable-inline-code")).toBe(true);
            $inline.trigger("click"); // non-share path
            expect(clip.copyTextWithToast).toHaveBeenCalledWith("inline");

            ctrl.isShare = true;
            const $inline2 = $("<code>").text("inline share");
            mod.applyInlineCodeCopy($inline2);
            $inline2.trigger("click"); // share path
            expect(clip.copyText).toHaveBeenCalledWith("inline share");
        });
    });

    describe("formatCodeBlocks", () => {
        function buildContainer() {
            const $container = $("<div>");
            const $pre = $("<pre>");
            const $code = $("<code>").addClass("language-text-css").text("a{}");
            $pre.append($code);
            const $preNoLang = $("<pre>");
            $preNoLang.append($("<code>").text("no language here"));
            const $inline = $("<code>").text("inline");
            $container.append($pre, $preNoLang, $inline);
            return { $container, $code, $inline };
        }

        it("highlights code blocks, skips unlabeled blocks, adds copy buttons + inline copy", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            const { $container, $code, $inline } = buildContainer();

            await mod.formatCodeBlocks($container);
            await flush();

            // labeled block highlighted
            expect($code.html()).toBe("HL");
            // copy button added only to the labeled <pre> (the unlabeled one is skipped)
            expect($container.find("pre button.copy-button").length).toBe(1);
            // inline code (not inside a <pre>) got the click-to-copy class
            expect($inline.hasClass("copyable-inline-code")).toBe(true);
            // at least one inline-copy element was registered
            expect($container.find("code.copyable-inline-code").length).toBeGreaterThanOrEqual(1);
        });

        it("skips copy buttons and highlighting affordances entirely in print mode", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            (window as any).glob = { device: "print" };
            const { $container, $code } = buildContainer();

            await mod.formatCodeBlocks($container);
            await flush();

            expect($container.find("button.copy-button").length).toBe(0);
            expect($container.find("code.copyable-inline-code").length).toBe(0);
            // highlighting still applied to the labeled block
            expect($code.html()).toBe("HL");
        });

        it("ignores non-language classes when extracting the language tag", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            const $container = $("<div>");
            const $pre = $("<pre>");
            // a non-language class precedes the language one -> exercises the
            // "doesn't start with language-" branch before the match.
            const $code = $("<code>").addClass("hljs").addClass("language-text-css").text("a{}");
            $pre.append($code);
            $container.append($pre);

            await mod.formatCodeBlocks($container);
            await flush();

            expect($code.html()).toBe("HL");
        });

        it("does not highlight when syntax highlighting is disabled, but still adds copy buttons", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "none" });
            const { $container, $code } = buildContainer();

            await mod.formatCodeBlocks($container);
            await flush();

            expect($code.html()).toBe("a{}"); // untouched
            expect(hl.highlight).not.toHaveBeenCalled();
            // copy button added only to the labeled <pre> (the unlabeled one is skipped)
            expect($container.find("pre button.copy-button").length).toBe(1);
        });
    });

    describe("color scheme listener + cache eviction", () => {
        it("registers a matchMedia listener once and re-applies theme on change", async () => {
            const mod = await freshModule();
            setOptions({
                codeBlockThemeMatchesApp: "true",
                codeBlockThemeLight: "default:vs",
                codeBlockThemeDark: "default:agate",
                codeNotesMimeTypes: "[]"
            });

            let changeHandler: (() => void) | undefined;
            const addEventListener = vi.fn((_evt: string, cb: () => void) => {
                changeHandler = cb;
            });
            (window as any).matchMedia = vi.fn(() => ({ matches: true, addEventListener }));
            (window as any).glob = { isMainWindow: true, theme: "auto" };

            // first ensure registers the listener and marks highlightingLoaded
            await mod.ensureMimeTypesForHighlighting("text-css");
            expect(addEventListener).toHaveBeenCalledTimes(1);

            hl.loadTheme.mockClear();
            // OS scheme change with matchesApp=true + highlightingLoaded -> re-load theme
            changeHandler!();
            expect(hl.loadTheme).toHaveBeenCalledTimes(1);

            // a second ensure must NOT register the listener again
            await mod.ensureMimeTypesForHighlighting("text-x-csrc");
            expect(addEventListener).toHaveBeenCalledTimes(1);
        });

        it("registers the matchMedia listener at most once (idempotent)", async () => {
            const mod = await freshModule();
            const addEventListener = vi.fn();
            (window as any).matchMedia = vi.fn(() => ({ matches: false, addEventListener }));

            mod.ensureColorSchemeListener();
            mod.ensureColorSchemeListener(); // second call hits the early-return
            expect(addEventListener).toHaveBeenCalledTimes(1);
        });

        it("does not re-apply the theme on change when matchesApp is false", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs", codeNotesMimeTypes: "[]" });

            let changeHandler: (() => void) | undefined;
            const addEventListener = vi.fn((_evt: string, cb: () => void) => {
                changeHandler = cb;
            });
            (window as any).matchMedia = vi.fn(() => ({ matches: false, addEventListener }));

            await mod.ensureMimeTypesForHighlighting("text-css");
            hl.loadTheme.mockClear();

            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });
            changeHandler!();
            expect(hl.loadTheme).not.toHaveBeenCalled();
        });

        it("evicts the oldest cache entry once the cache is full (FIFO)", async () => {
            const mod = await freshModule();
            setOptions({ codeBlockThemeMatchesApp: "false", codeBlockTheme: "default:vs" });

            // Fill the cache beyond its max so eviction fires.
            for (let i = 0; i < 260; i++) {
                hl.highlight.mockImplementation(() => ({ value: `v${i}` }));
                const $a = $codeBlock(`code-${i}`, "text-css");
                await mod.applySingleBlockSyntaxHighlight($a, "text-css");
            }

            // The very first entry should have been evicted: re-highlighting it
            // calls highlight() again instead of serving a cache hit.
            hl.highlight.mockClear().mockImplementation(() => ({ value: "fresh" }));
            const $first = $codeBlock("code-0", "text-css");
            await mod.applySingleBlockSyntaxHighlight($first, "text-css");
            expect(hl.highlight).toHaveBeenCalledTimes(1);
            expect($first.html()).toBe("fresh");

            // A recent entry is still cached: no re-highlight.
            hl.highlight.mockClear();
            const $recent = $codeBlock("code-259", "text-css");
            await mod.applySingleBlockSyntaxHighlight($recent, "text-css");
            expect(hl.highlight).not.toHaveBeenCalled();
        });
    });
});
