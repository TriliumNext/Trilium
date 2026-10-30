import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca.js";

type PreviewModule = typeof import("./code_note_preview.js");
type CodeMirrorPreviewModule = typeof import("@triliumnext/codemirror/src/code_preview.js");

const CODE = "const a = 1;\nlet b = 2;";
const DEVICE = window.glob.device;

describe("renderCodeNotePreview", () => {
    afterEach(() => {
        window.glob.device = DEVICE;
        for (const style of document.head.querySelectorAll("style")) style.remove();
    });

    it("colors the preview with the light and dark themes, each scoped to its scheme", async () => {
        const { renderCodeNotePreview } = await freshModule({ codeNoteThemeMatchesApp: "true" });
        const pre = await renderCodeNotePreview(CODE, "text/javascript");

        expect({ ...pre.dataset }).toEqual({
            codeThemeL: "vs-code-light", codeThemeD: "vs-code-dark"
        });
        expect(pre.querySelectorAll(".code-preview-line").length).toBe(2);
        expect(pre.querySelector(".code-preview-line span")?.className).toMatch(/^l\d+ d\d+$/);
        const styles = [ ...document.head.querySelectorAll("style") ].map((s) => s.textContent);
        expect(styles.map((css) => css?.split(" .code-preview")[0])).toEqual([
            ":where(body:not(.dark-theme))", ":where(body.dark-theme)"
        ]);

        // A second preview reuses the CSS, and the HTML of the same content.
        const again = await renderCodeNotePreview(CODE, "text/javascript");
        expect(again).not.toBe(pre);
        expect(again.outerHTML).toBe(pre.outerHTML);
        expect(document.head.querySelectorAll("style").length).toBe(2);
    });

    it("uses the one theme unless they follow the app, and the light theme to print", async () => {
        const { renderCodeNotePreview } = await freshModule({ codeNoteThemeMatchesApp: "false" });

        const single = await renderCodeNotePreview(CODE, "text/javascript");
        expect({ ...single.dataset }).toEqual({ codeThemeT: "monokai" });

        window.glob.device = "print";
        const printed = await renderCodeNotePreview(CODE, "text/javascript");
        expect({ ...printed.dataset }).toEqual({ codeThemeT: "vs-code-light" });
        expect(document.head.querySelector("style")?.textContent)
            .toMatch(/^\.code-preview\[data-code-theme-t="monokai"\]/);
    });

    it("gives the colors of the code theme for a light or a dark background, unscoped, for a slide", async () => {
        const matching = await freshModule({ codeNoteThemeMatchesApp: "true" });
        expect(await matching.getCodePreviewThemeCss(false))
            .toMatch(/^\.code-preview\[data-code-theme-l="vs-code-light"\]/);
        expect(await matching.getCodePreviewThemeCss(true))
            .toMatch(/^\.code-preview\[data-code-theme-d="vs-code-dark"\]/);

        const single = await freshModule({ codeNoteThemeMatchesApp: "false" });
        expect(await single.getCodePreviewThemeCss(true)).toMatch(/^\.code-preview\[data-code-theme-t="monokai"\]/);
    });

    it("falls back to the default style for a theme that is not a built-in one", async () => {
        const { renderCodeNotePreview } = await freshModule({
            codeNoteThemeMatchesApp: "false", codeNoteTheme: "custom"
        });
        const pre = await renderCodeNotePreview(CODE, "text/javascript");
        expect({ ...pre.dataset }).toEqual({ codeThemeT: "default" });
    });

    it("wraps the lines by the `#wrapLines` label of the note, else by the option", async () => {
        const { renderCodeNotePreview } = await freshModule({ codeLineWrapEnabled: "true" });
        const isWrapped = async (note?: Parameters<PreviewModule["renderCodeNotePreview"]>[2]) =>
            (await renderCodeNotePreview(CODE, "text/javascript", note))
                .classList.contains("code-preview-wrap");

        expect(await isWrapped()).toBe(true);
        expect(await isWrapped(buildNote({ title: "Off", "#wrapLines": "false" }))).toBe(false);
        expect(await isWrapped(buildNote({ title: "On", "#wrapLines": "" }))).toBe(true);
    });

    it("wraps and numbers the lines as an embed sets, over the note and the option", async () => {
        const { renderCodeNotePreview } = await freshModule({ codeLineWrapEnabled: "true" });
        const note = buildNote({ title: "On", "#wrapLines": "" });
        const render = (lines: Parameters<PreviewModule["renderCodeNotePreview"]>[3]) =>
            renderCodeNotePreview(CODE, "text/javascript", note, lines);

        expect((await render({})).className).toBe("code-preview code-preview-wrap");
        expect((await render({ isWrapped: false, hasLineNumbers: false })).className)
            .toBe("code-preview code-preview-no-line-numbers");
    });

    it("numbers the lines by the option, unless an embed sets them", async () => {
        const { renderCodeNotePreview } = await freshModule({ codeLineNumbersEnabled: "false" });
        const isNumbered = async (hasLineNumbers?: boolean) =>
            !(await renderCodeNotePreview(CODE, "text/javascript", null, { hasLineNumbers }))
                .classList.contains("code-preview-no-line-numbers");

        expect(await isNumbered()).toBe(false);
        expect(await isNumbered(true)).toBe(true);
    });

    it("shows code too long to highlight plain, still numbered", async () => {
        const { renderCodeNotePreview } = await freshModule({});
        const long = Array.from({ length: 600 }, () => "let a = 1;").join("\n");
        const pre = await renderCodeNotePreview(long, "text/javascript");

        expect(pre.querySelectorAll(".code-preview-line").length).toBe(600);
        expect(pre.querySelectorAll(".code-preview-line span").length).toBe(0);
        expect(pre.getAttribute("style")).toBe("--code-preview-digits: 3");
    });

    it("renders the same content once, until others fill the budget of characters", async () => {
        const renderCodePreview = vi.fn();
        vi.doMock("@triliumnext/codemirror/src/code_preview.js", async (importOriginal) => {
            const original = await importOriginal<CodeMirrorPreviewModule>();
            renderCodePreview.mockImplementation(original.renderCodePreview);
            return { ...original, renderCodePreview };
        });
        try {
            const { renderCodeNotePreview } = await freshModule({});
            const isRendered = async (content: string) => {
                const calls = renderCodePreview.mock.calls.length;
                await renderCodeNotePreview(content, "text/plain");
                return renderCodePreview.mock.calls.length > calls;
            };
            const large = (index: number) => `${index}${"x".repeat(400_000)}`;

            expect(await isRendered("a = 0")).toBe(true);
            expect(await isRendered("a = 0")).toBe(false);

            // A preview over the limit of one entry is not cached, and pushes out nothing.
            const huge = "x".repeat(1_000_000);
            expect(await isRendered(huge)).toBe(true);
            expect(await isRendered(huge)).toBe(true);
            expect(await isRendered("a = 0")).toBe(false);

            // Ten entries of about 800,000 characters, key and preview, overrun the budget.
            for (let index = 0; index < 10; index++) {
                expect(await isRendered(large(index))).toBe(true);
            }
            expect(await isRendered("a = 0")).toBe(true);
            expect(await isRendered(large(0))).toBe(true);
            expect(await isRendered(large(9))).toBe(false);
        } finally {
            vi.doUnmock("@triliumnext/codemirror/src/code_preview.js");
        }
    });
});

/** Loads the module again, so its caches start empty, with `values` over the default options. */
async function freshModule(values: Record<string, string>): Promise<PreviewModule> {
    vi.resetModules();
    const options = (await import("./options.js")).default;
    options.load({
        codeNoteThemeMatchesApp: "true",
        codeNoteTheme: "default:monokai",
        codeNoteThemeLight: "default:vs-code-light",
        codeNoteThemeDark: "default:vs-code-dark",
        codeLineWrapEnabled: "false",
        codeLineNumbersEnabled: "true",
        ...values
    });
    return import("./code_note_preview.js");
}
