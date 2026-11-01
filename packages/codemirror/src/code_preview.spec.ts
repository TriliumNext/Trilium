import { defaultHighlightStyle, type Language } from "@codemirror/language";
import { describe, expect, it, vi } from "vitest";

import {
    getLoadedPreviewLanguage, loadPreviewLanguage, loadPreviewTheme, type PreviewThemeSlot,
    renderCodePreview
} from "./code_preview.js";
import ColorThemes from "./color_themes.js";

const parser = vi.hoisted(() => ({ isTimedOut: false }));
const TWO_THEME_CLASSES = /^l\d+ d\d+$/;

vi.mock("@codemirror/language", async (importOriginal) => {
    const original = await importOriginal<typeof import("@codemirror/language")>();
    return {
        ...original,
        ensureSyntaxTree: (...args: Parameters<typeof original.ensureSyntaxTree>) =>
            (parser.isTimedOut ? null : original.ensureSyntaxTree(...args))
    };
});

describe("renderCodePreview", () => {
    it("renders a line per source line, with the classes of every theme", async () => {
        const slots = await loadSlots();
        const language = await loadPreviewLanguage("text/javascript");
        const pre = parse(renderCodePreview("const a = \"<b>&\";\r\n\n/* x\ny */", {
            themes: slots, language, isWrapped: true
        }));

        expect(pre.className).toBe("code-preview code-preview-wrap");
        expect([ pre.dataset.codeThemeL, pre.dataset.codeThemeD ])
            .toEqual([ "vs-code-light", "vs-code-dark" ]);
        expect(pre.getAttribute("style")).toBe("--code-preview-digits: 1");
        expect(pre.textContent).toBe("const a = \"<b>&\";\n\n/* x\ny */");

        const lines = [ ...pre.querySelectorAll(".code-preview-line") ];
        expect(lines.map((line) => line.textContent))
            .toEqual([ "const a = \"<b>&\";", "", "/* x", "y */" ]);
        const keyword = lines[0].querySelector("span");
        expect(keyword?.textContent).toBe("const");
        expect(keyword?.className).toMatch(TWO_THEME_CLASSES);
        // A comment over two lines is split at the line break.
        expect(lines.slice(2).map((line) => line.querySelector("span")?.className)).toEqual([
            expect.stringMatching(TWO_THEME_CLASSES), expect.stringMatching(TWO_THEME_CLASSES)
        ]);
    });

    it("shows the code plain without a language, or once the parser runs out of time", async () => {
        const slots = await loadSlots();
        const code = Array.from({ length: 10 }, (_, index) => `x < ${index}`).join("\n");
        const language = await loadPreviewLanguage("text/javascript");
        const render = (previewLanguage: Language | null) => parse(renderCodePreview(code, {
            themes: slots, language: previewLanguage, isWrapped: false
        }));

        const plain = render(null);
        expect(plain.className).toBe("code-preview");
        expect(parse(renderCodePreview(code, {
            themes: slots, language: null, isWrapped: true, hasLineNumbers: false
        })).className).toBe("code-preview code-preview-wrap code-preview-no-line-numbers");
        expect(plain.getAttribute("style")).toBe("--code-preview-digits: 2");
        expect(plain.querySelectorAll(".code-preview-line span").length).toBe(0);
        expect(plain.querySelector(".code-preview-line")?.innerHTML).toBe("x &lt; 0");

        parser.isTimedOut = true;
        try {
            expect(render(language).querySelectorAll(".code-preview-line span").length).toBe(0);
        } finally {
            parser.isTimedOut = false;
        }
        expect(render(language).querySelectorAll(".code-preview-line span").length)
            .toBeGreaterThan(0);
    });
});

describe("loadPreviewTheme", () => {
    it("reads the colors of every code note theme", async () => {
        for (const { id } of ColorThemes) {
            const theme = await loadPreviewTheme(id);
            expect(theme.id).toBe(id);
            expect(theme.styles.length).toBeGreaterThan(0);
            expect(theme.colors).toMatchObject({
                background: expect.any(String),
                foreground: expect.any(String),
                gutterBackground: expect.any(String),
                gutterForeground: expect.any(String)
            });
        }
        const cached = loadPreviewTheme("vs-code-light");
        expect(loadPreviewTheme("vs-code-light")).toBe(cached);
    });

    it("falls back to the default highlight style for an unknown theme", async () => {
        const theme = await loadPreviewTheme("missing");
        expect(theme).toEqual({ id: "default", styles: defaultHighlightStyle.specs, colors: {} });
    });
});

describe("loadPreviewLanguage", () => {
    it("loads the language of a MIME type once", async () => {
        expect(getLoadedPreviewLanguage("text/x-python")).toBeUndefined();
        const python = loadPreviewLanguage("text/x-python");
        expect(loadPreviewLanguage("text/x-python")).toBe(python);
        expect((await python)?.name).toBe("python");
        expect(getLoadedPreviewLanguage("text/x-python")).toBe(await python);

        const names = await Promise.all([ "text/css", "application/json", "image/svg+xml" ]
            .map(async (mime) => (await loadPreviewLanguage(mime))?.name));
        expect(names).toEqual([ "css", "json", "xml" ]);
    });

    it("has no language for plain text, the backend log or an unknown MIME type", async () => {
        const results: (Language | null)[] = [];
        for (const mime of [ "text/plain", "text/x-trilium-log", "application/x-unknown" ]) {
            results.push(await loadPreviewLanguage(mime));
        }
        expect(results).toEqual([ null, null, null ]);
        expect(getLoadedPreviewLanguage("text/plain")).toBeNull();
    });
});

async function loadSlots(): Promise<PreviewThemeSlot[]> {
    const [ light, dark ] = await Promise.all([
        loadPreviewTheme("vs-code-light"), loadPreviewTheme("vs-code-dark")
    ]);
    return [ { theme: light, key: "l" }, { theme: dark, key: "d" } ];
}

function parse(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const pre = template.content.firstElementChild;
    if (!(pre instanceof HTMLPreElement)) throw new Error("No <pre> in the preview.");
    return pre;
}
