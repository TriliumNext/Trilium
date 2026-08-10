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

    describe("links between pages", () => {
        const meta: HelpMetaItem[] = [
            { id: "_help_types", title: "Note Types", type: "book", dir: "User Guide/Note Types", children: [
                { id: "_help_text", title: "Text", type: "text", source: "User Guide/Note Types/Text.md" },
                { id: "_help_code", title: "Code", type: "text", source: "User Guide/Note Types/Code.md" }
            ] },
            { id: "_help_intro", title: "Intro", type: "text", source: "User Guide/Intro.md" }
        ];

        /** Renders the given body as the "Text" page and returns the values of one attribute. */
        function urlsOf(body: string, attribute: "href" | "src"): string[] {
            const bundle = buildHelpBundle(
                meta,
                readFrom({ "User Guide/Note Types/Text.md": body }),
                (markdown) => markdown
            );
            return [ ...bundle._help_text.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g")) ].map((m) => m[1]);
        }

        const hrefsOf = (body: string) => urlsOf(body, "href");
        const srcsOf = (body: string) => urlsOf(body, "src");

        it("resolves relative paths against the linking page and rewrites them to note links", () => {
            expect(hrefsOf('<a href="Code.md">sibling</a>')).toEqual([ "#root/_help_code" ]);
            expect(hrefsOf('<a href="../Intro.md">up a level</a>')).toEqual([ "#root/_help_intro" ]);
            // Titles carry spaces, so the authored links are percent-encoded.
            expect(hrefsOf('<a href="../Note%20Types/Code.md">encoded</a>')).toEqual([ "#root/_help_code" ]);
            // A folder note is linked without its extension.
            expect(hrefsOf('<a href="../Intro">extensionless</a>')).toEqual([ "#root/_help_intro" ]);
            // A note is addressed as a whole, so a fragment on the path has nothing to point at.
            expect(hrefsOf('<a href="Code.md#syntax">fragment</a>')).toEqual([ "#root/_help_code" ]);
        });

        it("resolves a link to a folder note, which has no file of its own", () => {
            expect(hrefsOf('<a href="../Note%20Types">the folder</a>')).toEqual([ "#root/_help_types" ]);
        });

        it("rewrites markdown-authored links, not just the reference links in raw HTML", () => {
            const bundle = buildHelpBundle(
                meta,
                readFrom({ "User Guide/Note Types/Text.md": "[Code](Code.md)" }),
                (markdown) => markdown.replace(/\[(.*?)\]\((.*?)\)/, '<a href="$2">$1</a>')
            );
            expect(bundle._help_text).toBe('<a href="#root/_help_code">Code</a>');
        });

        it("leaves alone everything that addresses something other than a file of the guide", () => {
            // External link, in-page footnote anchor, an existing deep link into a system note,
            // and a markdown page the guide does not ship — a broken link, kept visible as
            // authored rather than disguised as an asset URL.
            const untouched = [
                "https://example.com/Code.md",
                "#fn1saoftmefpp",
                "#root/_hidden/_options",
                "../../Technical Guide/Internals.md"
            ];

            for (const href of untouched) {
                expect(hrefsOf(`<a href="${href}">link</a>`)).toEqual([ href ]);
            }
        });

        it("turns asset references into placeholder paths from the export root", () => {
            // Pages write these both ways: raw in an <img src>, percent-encoded in markdown image
            // syntax — and the renderer escapes the ampersands of either as HTML. All three come
            // out as one consistently encoded URL.
            expect(hrefsOf('<img src="Text_image.png">'))
                .toEqual([]);
            expect(srcsOf('<img src="Text_image.png">'))
                .toEqual([ "{{helpAssets}}/User%20Guide/Note%20Types/Text_image.png" ]);
            expect(srcsOf('<img src="../Import%20%26%20Export/pic.png">'))
                .toEqual([ "{{helpAssets}}/User%20Guide/Import%20%26%20Export/pic.png" ]);
            expect(srcsOf('<img src="../Import &amp; Export/pic.png">'))
                .toEqual([ "{{helpAssets}}/User%20Guide/Import%20%26%20Export/pic.png" ]);
            // The attachments a few pages link to are assets as well, not notes.
            expect(hrefsOf('<a href="Backend%20API.dat">API</a>'))
                .toEqual([ "{{helpAssets}}/User%20Guide/Note%20Types/Backend%20API.dat" ]);
        });

        it("does not touch the contents of code notes", () => {
            const script = 'const link = \'<a href="Code.md">\';\n';
            const bundle = buildHelpBundle(
                [ { id: "_help_script", title: "Example", type: "code", source: "User Guide/Example.js" } ],
                readFrom({ "User Guide/Example.js": script }),
                render
            );

            expect(bundle._help_script).toBe(script);
        });
    });

    it("keeps an empty page as an empty entry, distinct from having no content at all", () => {
        const meta: HelpMetaItem[] = [
            { id: "_help_empty", title: "Empty", type: "text", source: "User Guide/Empty.md" }
        ];

        const bundle = buildHelpBundle(meta, readFrom({ "User Guide/Empty.md": "" }), (markdown) => markdown);

        expect(bundle).toHaveProperty("_help_empty", "");
    });
});
