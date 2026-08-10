import type { HelpMetaItem } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import { buildHelpBundle } from "./help_bundle_generator.js";

const render = (markdown: string, title: string) => `<h1>${title}</h1>${markdown.trim()}`;
const readFrom = (pages: Record<string, string>) => (source: string) => pages[source] ?? null;

describe("buildHelpBundle", () => {
    it("renders pages by note ID, descends into folders and skips notes without content", () => {
        const meta: HelpMetaItem[] = [
            {
                id: "_help_folder",
                title: "Note Types",
                type: "book",
                children: [
                    { id: "_help_text", title: "Text", type: "text", source: "User Guide/Note Types/Text.md" },
                    { id: "_help_embed", title: "Embedded", type: "webView" }
                ]
            }
        ];

        const bundle = buildHelpBundle(meta, readFrom({ "User Guide/Note Types/Text.md": "# Text\nBody" }), render);

        // Folders and web views have no content of their own, so they get no entry at all.
        expect(Object.keys(bundle)).toEqual([ "_help_text" ]);
        expect(bundle._help_text).toBe("<h1>Text</h1># Text\nBody");
    });

    it("keeps code notes verbatim instead of rendering them as markdown", () => {
        const meta: HelpMetaItem[] = [
            { id: "_help_script", title: "Example", type: "code", mime: "text/javascript", source: "User Guide/Example.js" }
        ];
        const script = "// # not a heading\nconst x = 1;\n";

        const bundle = buildHelpBundle(meta, readFrom({ "User Guide/Example.js": script }), render);

        expect(bundle._help_script).toBe(script);
    });

    it("skips a page whose file cannot be read rather than failing the whole export", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const meta: HelpMetaItem[] = [
            { id: "_help_gone", title: "Missing", type: "text", source: "User Guide/Missing.md" },
            { id: "_help_here", title: "Present", type: "text", source: "User Guide/Present.md" }
        ];

        const bundle = buildHelpBundle(meta, readFrom({ "User Guide/Present.md": "Body" }), render);

        expect(Object.keys(bundle)).toEqual([ "_help_here" ]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("User Guide/Missing.md"));
        warn.mockRestore();
    });

    it("keeps an empty page as an empty entry, distinct from having no content at all", () => {
        const meta: HelpMetaItem[] = [
            { id: "_help_empty", title: "Empty", type: "text", source: "User Guide/Empty.md" }
        ];

        const bundle = buildHelpBundle(meta, readFrom({ "User Guide/Empty.md": "" }), (markdown) => markdown);

        expect(bundle).toHaveProperty("_help_empty", "");
    });
});
