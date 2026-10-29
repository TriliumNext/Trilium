import { describe, expect, it } from "vitest";

import { collectEditorStylesheet } from "./slide_editor";

describe("collectEditorStylesheet", () => {
    it("copies the editor's UI rules and leaves out the content rules", () => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
            .ck.ck-toolbar { color: red; }
            .ck-editor__editable .ck-code-block__type-around__button svg { width: 10px; }
            .ck-content h2 { font-size: 3em; }
            .note-detail-editable-text h3 { font-size: 2em; }
            :root, :host { --ck-color-text: black; }
            @media (max-width: 600px) {
                .ck-balloon-panel { max-width: 90vw; }
                .ck-content p { margin: 0; }
            }
            @media print {
                .ck-content table { border: 0; }
            }
            @keyframes ck-highlight { from { opacity: 0; } }
        `);

        const css = collectEditorStylesheet([ sheet ]);

        expect(css).toContain(".ck.ck-toolbar");
        expect(css).toContain(".ck-code-block__type-around__button svg");
        expect(css).toContain("@media (max-width: 600px)");
        expect(css).toContain(".ck-balloon-panel");
        expect(css).toContain("@keyframes ck-highlight");
        expect(css).not.toContain(".ck-content");
        expect(css).not.toContain(".note-detail-editable-text");
        expect(css).not.toContain("--ck-color-text");
        expect(css).not.toContain("@media print");
    });

    it("skips a stylesheet whose rules cannot be read", () => {
        const crossOrigin = {
            get cssRules(): CSSRuleList {
                throw new DOMException("cross-origin", "SecurityError");
            }
        } as CSSStyleSheet;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(".ck-toolbar { color: red; }");

        expect(collectEditorStylesheet([ crossOrigin, sheet ])).toContain(".ck-toolbar");
    });
});
