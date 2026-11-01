import { describe, expect, it } from "vitest";
import definitions, { byMimeType } from "./syntax_highlighting.js";
import hljs from "highlight.js";

describe("Syntax highlighting definitions", () => {
    it("every entry is readable", async () => {
        for (const [ mime, loader ] of Object.entries(definitions)) {
            if (loader === null) {
                continue;
            }

            const language = (await loader()).default;

            hljs.registerLanguage(mime, language);
            hljs.highlight("Hello world", {
                language: mime
            });
        }
    });

    it("highlights languages without a grammar of their own with the closest core one", async () => {
        const closest = {
            "text/x-spreadsheet": await import("highlight.js/lib/languages/excel"),
            "text/x-stex": await import("highlight.js/lib/languages/latex"),
            "text/x-octave": await import("highlight.js/lib/languages/matlab"),
            "text/x-literate-haskell": await import("highlight.js/lib/languages/haskell")
        } as const;

        for (const [ mime, grammar ] of Object.entries(closest)) {
            const loader = byMimeType[mime as keyof typeof closest];
            expect(loader, mime).not.toBeNull();
            expect((await loader?.())?.default, mime).toBe(grammar.default);
        }
    });
});
