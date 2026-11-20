// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import VanillaCodeMirror from "@triliumnext/codemirror";
import { HIGHLIGHT_STYLE } from "@triliumnext/commons/src/lib/marked_extensions.js";
import { h, type Ref, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type TabManager from "../../../components/tab_manager";
import type FNote from "../../../entities/fnote";
import { consumeBlockReference } from "../../../services/block_reference";
import { consumeBookmark } from "../../../services/bookmark_jump";
import type { ViewScope } from "../../../services/link";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type { HeadingContext } from "../../sidebar/TableOfContents";
import type { SplitEditorProps } from "../helpers/SplitEditor";
import { getMarkdownReferenceSource, revealInSource } from "./editor_block_references";
import { showEditLinkDialog } from "./editor_utils";
import Markdown, {
    findActiveBlock, placePreviewMarker, renderWithSourceLines, revealTabAtLine, scrollToSourceLine
} from "./Markdown.js";

/** The props of each stub of `SplitEditor`, by `ntxId`, and the splits without a preview. */
const splits = vi.hoisted(() => ({
    props: new Map<string, SplitEditorProps>(),
    withoutPreview: new Set<string>()
}));

// The specs give the split its editor and the content of the note.
vi.mock("../helpers/SplitEditor", async (importOriginal) => {
    const preact = await import("preact");
    return {
        ...await importOriginal<typeof import("../helpers/SplitEditor")>(),
        default: (props: SplitEditorProps) => {
            const ntxId = String(props.ntxId);
            splits.props.set(ntxId, props);
            const preview = splits.withoutPreview.has(ntxId) ? null : props.previewContent;
            return preact.h("div", null, preview);
        }
    };
});
vi.mock("../text/ReadOnlyText", async (importOriginal) => {
    const preact = await import("preact");
    return {
        ...await importOriginal<typeof import("../text/ReadOnlyText")>(),
        ReadOnlyTextContent: ({ html, className, contentRef }: {
            html: string; className?: string; contentRef?: Ref<HTMLDivElement>;
        }) => preact.h("div", {
            className, ref: contentRef, dangerouslySetInnerHTML: { __html: html }
        })
    };
});
vi.mock("./editor_block_references", async (importOriginal) => ({
    ...await importOriginal<typeof import("./editor_block_references")>(),
    revealInSource: vi.fn()
}));
vi.mock("./editor_utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("./editor_utils")>(),
    showEditLinkDialog: vi.fn()
}));
vi.mock("../../../services/block_reference", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/block_reference")>(),
    consumeBlockReference: vi.fn()
}));
vi.mock("../../../services/bookmark_jump", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/bookmark_jump")>(),
    consumeBookmark: vi.fn()
}));

describe("renderWithSourceLines", () => {
    function extractLines(src: string): number[] {
        const { html } = renderWithSourceLines(src);
        return [ ...html.matchAll(/data-source-line="(\d+)"/g) ].map((m) => parseInt(m[1], 10));
    }

    /** Markup with the source-line attributes stripped, so markup assertions stay readable. */
    function html(src: string): string {
        return renderWithSourceLines(src).html.replace(/ data-source-line="\d+"/g, "");
    }

    it("returns empty html for empty input", () => {
        expect(html("")).toBe("");
    });

    it("tags a single block as line 1", () => {
        const result = html("hello");
        expect(extractLines("hello")).toEqual([ 1 ]);
        expect(result).toContain("hello");
    });

    it("assigns correct source lines to consecutive blocks separated by blank lines", () => {
        const src = [
            "# Heading",       // line 1
            "",                // line 2
            "A paragraph.",    // line 3
            "",                // line 4
            "Another one."     // line 5
        ].join("\n");

        expect(extractLines(src)).toEqual([ 1, 3, 5 ]);
    });

    it("counts multi-line blocks so subsequent blocks get the right line", () => {
        const src = [
            "```",             // 1
            "code",            // 2
            "more code",       // 3
            "```",             // 4
            "",                // 5
            "after"            // 6
        ].join("\n");

        expect(extractLines(src)).toEqual([ 1, 6 ]);
    });

    it("gives raw HTML around Markdown one line, and the blocks after it their own", () => {
        const src = [
            "Intro",                                    // 1
            "",
            "<aside>",                                  // 3
            "",
            "A side note",                              // 5
            "",
            "# Heading in the aside",                   // 7
            "",
            "</aside>",                                 // 9
            "",
            "After the aside",                          // 11
            "",
            '<details class="trilium-collapsible">',    // 13
            "<summary>Summary</summary>",
            "",
            "Details",                                  // 16
            "",
            "</details>",                               // 18
            "",
            "<!-- A comment renders nothing -->",       // 20
            "",
            "After the comment",                        // 22
            "",
            "<div>One HTML block,</div>",               // 24
            "<div>two elements</div>",
            "",
            "Last"                                      // 27
        ].join("\n");

        const container = document.createElement("div");
        container.innerHTML = renderWithSourceLines(src).html;
        const blocks = container.querySelectorAll<HTMLElement>("[data-source-line]");
        expect(Array.from(blocks, (block) => [ block.tagName, block.dataset.sourceLine ])).toEqual([
            [ "P", "1" ], [ "ASIDE", "3" ], [ "P", "11" ], [ "DETAILS", "13" ], [ "P", "22" ],
            [ "DIV", "24" ], [ "DIV", "24" ], [ "P", "27" ]
        ]);

        // The caret on any line of the aside marks the aside.
        for (const line of [ 3, 5, 7, 9 ]) {
            expect(findActiveBlock(blocks, line)?.tagName).toBe("ASIDE");
        }
        expect(findActiveBlock(blocks, 11)?.textContent).toBe("After the aside");
        expect(renderWithSourceLines(src).headings).toMatchObject([ { line: 7 } ]);
    });

    it("renders standard markdown constructs", () => {
        const result = html("## Heading\n\n- item\n");
        expect(result).toContain("<h2>Heading</h2>");
        expect(result).toContain("<ul>");
        expect(result).toContain("<li>item</li>");
    });

    it("tags blocks in place so they stay direct siblings", () => {
        // The .ck-content styles use sibling combinators (e.g. the stacked look of consecutive
        // collapsibles), which only match if blocks are not each wrapped in a container.
        const src = [
            '<details class="trilium-collapsible">',
            "<summary>One</summary>",
            "</details>",
            "",
            '<details class="trilium-collapsible">',
            "<summary>Two</summary>",
            "</details>"
        ].join("\n");

        const container = document.createElement("div");
        container.innerHTML = renderWithSourceLines(src).html;

        const blocks = Array.from(container.children);
        expect(blocks.map((block) => block.tagName)).toEqual([ "DETAILS", "DETAILS" ]);
        expect(blocks.every((block) => block.hasAttribute("data-source-line"))).toBe(true);
    });

    it("counts a tabs block as one top-level block, so the lines after it stay aligned", () => {
        const src = [
            "Before",       // 1
            "",             // 2
            "=== \"A\"",    // 3
            "",             // 4
            "    a",        // 5
            "",             // 6
            "=== \"B\"",    // 7
            "",             // 8
            "    b",        // 9
            "",             // 10
            "After"         // 11
        ].join("\n");

        expect(extractLines(src)).toEqual([ 1, 3, 11 ]);
        expect(html(src)).toContain("<p>After</p>");
    });

    it("keeps H1 as H1 in the preview (no title-row context to avoid)", () => {
        expect(html("# Top level")).toContain("<h1>Top level</h1>");
    });

    it("preserves reference-style links across per-block parsing", () => {
        const src = [
            "[trilium][t]",    // 1
            "",                // 2
            "[t]: https://example.com"
        ].join("\n");

        expect(html(src)).toContain('href="https://example.com"');
    });

    it("normalizes fenced code languages to CKEditor MIME identifiers for syntax highlighting", () => {
        // A markdown code fence is not a Trilium script, so `javascript` maps to plain JavaScript
        // (`text/javascript`) rather than the frontend/backend script variants.
        expect(html("```javascript\nconst x = 1;\n```")).toMatch(/class="language-text-javascript"/);
    });

    it("produces CKEditor admonition markup for GFM callouts", () => {
        expect(html("> [!NOTE]\n> heads up")).toContain('<aside class="admonition note">');
    });

    it("preserves the `mermaid` fence language so the mermaid rewrite can match it", () => {
        expect(html("```mermaid\ngraph TD;\nA-->B;\n```")).toContain('class="language-mermaid"');
    });

    it("produces math-tex spans for inline math", () => {
        expect(html("Energy: $e=mc^2$.")).toContain('<span class="math-tex">');
    });

    it("renders the default /todo:<state> templates to their task states", () => {
        // The `/todo:*` commands insert `- [<symbol>] `; verify each default state's marker
        // round-trips to the right rendered task item. The ` ` (unchecked) and `x` (checked)
        // anchors map to native checkboxes; custom states carry data-trilium-task-state.
        const unchecked = html("- [ ] groceries");
        expect(unchecked).toContain('type="checkbox"');
        expect(unchecked).not.toContain("checked");
        expect(unchecked).not.toContain("data-trilium-task-state");

        expect(html("- [x] groceries")).toContain("checked");
        expect(html("- [/] groceries")).toContain('data-trilium-task-state="doing"');
        expect(html("- [?] groceries")).toContain('data-trilium-task-state="maybe"');
        expect(html("- [-] groceries")).toContain('data-trilium-task-state="cancelled"');
    });

    it("renders the /collapsible template as a details block", () => {
        // Mirrors the markdown the `/collapsible` slash command inserts.
        const src = [
            '<details class="trilium-collapsible">',
            "<summary>Summary</summary>",
            "",
            "Details",
            "",
            "</details>"
        ].join("\n");

        const result = html(src);
        expect(result).toContain("<details");
        expect(result).toContain("<summary>Summary</summary>");
        expect(result).toContain("Details");
    });

    it("renders the /page-break template as a page-break div without swallowing following content", () => {
        // Mirrors the markdown the `/page-break` slash command inserts (note the trailing blank line).
        // The renderer must keep the `page-break` class through DOMPurify so print.css can drive the
        // page break, and the blank line must terminate the raw-HTML block so following text still
        // renders as markdown instead of being absorbed into the <div>.
        const result = html('<div class="page-break"></div>\n\nAfter the break');
        expect(result).toContain('class="page-break"');
        expect(result).toContain("<p>After the break</p>");
    });

    it("renders the /aside template as a new aside, and the text after it", () => {
        const result = html("<aside>\n\nA **side** note\n\n</aside>\n\nAfter the aside");
        expect(result).toContain(
            '<aside style="--tn-background:#555555;background-color:#555555;" '
            + 'data-position="wrap-right"><p>A <strong>side</strong> note</p></aside>'
        );
        expect(result).toContain("<p>After the aside</p>");
    });

    it("renders the /table skeleton as a table without swallowing following content", () => {
        // Mirrors the GFM table the `/table` slash command inserts (note the trailing blank line),
        // which must terminate the table block so following text renders as its own paragraph.
        const src = [
            "| Column 1 | Column 2 |",
            "| -------- | -------- |",
            "|          |          |",
            "",
            "After the table"
        ].join("\n");

        const result = html(src);
        expect(result).toContain("<table>");
        expect(result).toContain("<th>Column 1</th>");
        expect(result).toContain("<p>After the table</p>");
    });

    it("renders [[wikilinks]] with hash-router hrefs so the preview navigates correctly", () => {
        const result = html("See [[abc123]] for details.");
        expect(result).toContain('class="reference-link"');
        expect(result).toContain('href="#root/abc123"');
    });

    it("extracts headings with correct levels and lines", () => {
        const src = [
            "# Title",         // line 1
            "",                // line 2
            "text",            // line 3
            "",                // line 4
            "## Section",      // line 5
            "",                // line 6
            "### Sub"          // line 7
        ].join("\n");

        const { headings } = renderWithSourceLines(src);
        expect(headings).toEqual([
            { id: "md-heading-0", level: 1, text: "Title", line: 1 },
            { id: "md-heading-1", level: 2, text: "Section", line: 5 },
            { id: "md-heading-2", level: 3, text: "Sub", line: 7 }
        ]);
    });

    it("renders inline markdown formatting in heading text", () => {
        const src = [
            "## **Bold heading**",
            "",
            "## *Italic heading*",
            "",
            "## `Code in heading`",
            "",
            "## Heading with **bold** and `code`",
            "",
            "## Heading with ~~strikethrough~~",
            "",
            "## Heading with [a link](https://example.com)"
        ].join("\n");

        const { headings } = renderWithSourceLines(src);
        expect(headings[0].text).toBe("<strong>Bold heading</strong>");
        expect(headings[1].text).toBe("<em>Italic heading</em>");
        expect(headings[2].text).toBe("<code>Code in heading</code>");
        expect(headings[3].text).toBe("Heading with <strong>bold</strong> and <code>code</code>");
        expect(headings[4].text).toBe("Heading with <del>strikethrough</del>");
        expect(headings[5].text).toBe('Heading with <a href="https://example.com">a link</a>');
    });

    it("sanitizes XSS vectors in heading text", () => {
        const src = [
            "## <script>alert('XSS via script tag')</script>",
            "",
            '## <button onclick="alert(\'clicked!\')">Click me</button>',
            "",
            '## <img src="x" onerror="alert(\'img onerror XSS\')">',
            "",
            '## <a href="javascript:alert(\'javascript: URL\')">Innocent link</a>',
            "",
            '## <svg onload="alert(\'SVG onload XSS\')"><rect width="100" height="100"/></svg>',
            "",
            "## <details><summary>Collapsible</summary><script>alert('inside details')</script></details>"
        ].join("\n");

        const { headings } = renderWithSourceLines(src);

        for (const h of headings) {
            expect(h.text).not.toMatch(/<script/i);
            expect(h.text).not.toMatch(/onerror/i);
            expect(h.text).not.toMatch(/onclick/i);
            expect(h.text).not.toMatch(/onload/i);
            expect(h.text).not.toMatch(/javascript:/i);
        }
    });

    it("renders ==text== as a highlight, surviving sanitization", () => {
        expect(html("==hi==")).toBe(`<p><span style="${HIGHLIGHT_STYLE}">hi</span></p>`);
        expect(html("a == b")).toBe("<p>a == b</p>");
    });

    describe("highlights", () => {
        function highlights(src: string) {
            return renderWithSourceLines(src).highlights;
        }

        it("extracts bold, italic and underline runs", () => {
            expect(highlights("**bold** and *italic* and <u>underline</u>").map(h => [ h.text, h.attrs.bold, h.attrs.italic, h.attrs.underline ]))
                .toEqual([
                    [ "bold", true, false, false ],
                    [ "italic", false, true, false ],
                    [ "underline", false, false, true ]
                ]);
        });

        it("traces each run back to the source line of its block, for scrolling the editor", () => {
            const src = [
                "# Heading",   // line 1
                "",            // line 2
                "a **one** b", // line 3
                "",            // line 4
                "c *two* d"    // line 5
            ].join("\n");

            expect(highlights(src).map(h => [ h.text, h.line ])).toEqual([ [ "one", 3 ], [ "two", 5 ] ]);
        });

        it("gives each run an id that is stable across re-renders", () => {
            const src = "**a** and *b*";
            expect(highlights(src).map(h => h.id)).toEqual(highlights(src).map(h => h.id));
        });

        it("picks up a ==highlight== as a background colour", () => {
            const [ highlight ] = highlights("some ==marked== text");

            expect(highlight.text).toBe("marked");
            expect(highlight.attrs.background).toBeTruthy();
        });

        it("finds nothing in unformatted text", () => {
            expect(highlights("just a plain paragraph")).toEqual([]);
        });
    });

    it("renders a colour the exporter preserved as inline HTML", () => {
        // Non-default colours survive a Markdown export as a span, so the preview has to show them.
        expect(html(`a <span style="color:#ff0000">**red**</span> b`))
            .toBe(`<p>a <span style="color:#ff0000;"><strong>red</strong></span> b</p>`);
    });
});

describe("findActiveBlock", () => {
    /** The preview's blocks, tagged with the source lines they start at. */
    function blocks(...sourceLines: number[]) {
        return sourceLines.map((line) => {
            const el = document.createElement("p");
            el.dataset.sourceLine = String(line);
            return el;
        });
    }

    it("picks the block the cursor sits in, and the last one past the end", () => {
        const [ first, second, third ] = blocks(1, 5, 9);
        const all = [ first, second, third ];

        expect(findActiveBlock(all, 1)).toBe(first);
        expect(findActiveBlock(all, 4)).toBe(first);
        expect(findActiveBlock(all, 5)).toBe(second);
        expect(findActiveBlock(all, 9)).toBe(third);
        expect(findActiveBlock(all, 100)).toBe(third);
    });

    it("matches nothing above the first block or in an empty preview", () => {
        expect(findActiveBlock(blocks(3), 1)).toBeNull();
        expect(findActiveBlock([], 1)).toBeNull();
    });
});

describe("placePreviewMarker", () => {
    /** A block of the preview with the given tag and class, laid out at `left` and `top`. */
    function block(tagName: string, className: string, left: number, top: number) {
        const el = document.createElement(tagName);
        el.className = className;
        Object.defineProperties(el, {
            offsetLeft: { value: left },
            offsetTop: { value: top },
            offsetHeight: { value: 30 }
        });
        return el;
    }

    it("marks an aside at its own left edge, and any other block at the gutter", () => {
        const preview = document.createElement("div");
        const marker = () => [ "left", "top", "height" ]
            .map((name) => preview.style.getPropertyValue(`--markdown-preview-marker-${name}`));

        placePreviewMarker(preview, block("aside", "", 400, 50));
        expect(marker()).toEqual([ "400px", "50px", "30px" ]);

        placePreviewMarker(preview, block("p", "", 16, 90));
        expect(marker()).toEqual([ "", "90px", "30px" ]);

        placePreviewMarker(preview, block("aside", "admonition note", 16, 130));
        expect(marker()).toEqual([ "", "130px", "30px" ]);

        placePreviewMarker(preview, block("aside", "", 400, 50));
        placePreviewMarker(preview, null);
        expect(marker()).toEqual([ "", "0px", "0px" ]);
    });
});

describe("scrollToSourceLine", () => {
    function preview() {
        const el = document.createElement("div");
        el.innerHTML = renderWithSourceLines("# One\n\ntext\n\n## Two\n\nmore").html;
        const heading = el.querySelector<HTMLElement>("h2");
        if (!heading) throw new Error("h2 not rendered");
        heading.scrollIntoView = vi.fn();
        return { el, heading };
    }

    /** A stand-in for the CodeMirror view, with a scroller of the given height (0 when hidden). */
    function editor(clientHeight: number) {
        const scrollTo = vi.fn();
        const view = {
            state: { doc: { lines: 7, line: () => ({ from: 0 }) } },
            lineBlockAt: () => ({ top: 0, height: 10 }),
            scrollDOM: { clientHeight, scrollTo }
        } as unknown as VanillaCodeMirror;
        return { view, scrollTo };
    }

    it("scrolls the preview when the editor is unmounted or hidden (preview mode)", () => {
        const { el, heading } = preview();
        expect(heading.dataset.sourceLine).toBe("5");

        scrollToSourceLine(null, el, 5);
        expect(heading.scrollIntoView).toHaveBeenCalledTimes(1);

        const hidden = editor(0);
        scrollToSourceLine(hidden.view, el, 5);
        expect(heading.scrollIntoView).toHaveBeenCalledTimes(2);
        expect(hidden.scrollTo).not.toHaveBeenCalled();
    });

    it("scrolls the editor when it is on screen, leaving the preview to follow", () => {
        const { el, heading } = preview();
        const visible = editor(400);

        scrollToSourceLine(visible.view, el, 5);
        expect(visible.scrollTo).toHaveBeenCalledTimes(1);
        expect(heading.scrollIntoView).not.toHaveBeenCalled();
    });
});

describe("revealTabAtLine", () => {
    // `applyTabs()` watches the title bars it builds, and jsdom has no `ResizeObserver`.
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            disconnect() {}
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const src = [
        "=== \"A\"",          // 1
        "",                     // 2
        "    a",                // 3
        "",                     // 4
        "=== \"B\"",          // 5
        "",                     // 6
        "    === \"B1\"",     // 7
        "",                     // 8
        "        b1",           // 9
        "",                     // 10
        "    === \"B2\"",     // 11
        "",                     // 12
        "        b2",           // 13
        "",                     // 14
        "After"                 // 15
    ].join("\n");

    function preview() {
        const el = document.createElement("div");
        el.innerHTML = renderWithSourceLines(src).html;
        applyTabs(el, { placeholder: "", scrollLabels: { start: "", end: "" } });
        return el;
    }

    function activeTitles(el: HTMLElement) {
        return [ ...el.querySelectorAll(".trilium-tab-title--active") ].map((title) => title.textContent);
    }

    it("tags each tab with the line of its header", () => {
        const lines = [ ...preview().querySelectorAll<HTMLElement>("section.trilium-tab") ]
            .map((tab) => tab.dataset.tabSourceLine);
        expect(lines).toEqual([ "1", "5", "7", "11" ]);
    });

    it("shows the tab the line falls in, including a nested one", () => {
        const el = preview();
        expect(activeTitles(el)).toEqual([ "A", "B1" ]);

        revealTabAtLine(el, 13);
        expect(activeTitles(el)).toEqual([ "B", "B2" ]);

        revealTabAtLine(el, 2);
        expect(activeTitles(el)).toEqual([ "A", "B2" ]);
    });

    it("tags the tabs of separate list items with their own lines", () => {
        const listSrc = [
            "- First",              // 1
            "",                     // 2
            "  === \"A\"",        // 3
            "",                     // 4
            "      a",              // 5
            "",                     // 6
            "- Second",             // 7
            "",                     // 8
            "  === \"B\"",        // 9
            "",                     // 10
            "      b"               // 11
        ].join("\n");
        const el = document.createElement("div");
        el.innerHTML = renderWithSourceLines(listSrc).html;
        const tabs = [ ...el.querySelectorAll<HTMLElement>("li section.trilium-tab") ];

        expect(tabs.map((tab) => tab.querySelector(".trilium-tab-title")?.textContent)).toEqual([ "A", "B" ]);
        expect(tabs.map((tab) => tab.dataset.tabSourceLine)).toEqual([ "3", "9" ]);
    });

    it("leaves the tabs alone for a line outside the block", () => {
        const el = preview();
        revealTabAtLine(el, 13);
        revealTabAtLine(el, 15);
        expect(activeTitles(el)).toEqual([ "B", "B2" ]);
    });
});

describe("Markdown", () => {
    // `useSyncedHighlight()` watches the blocks of the preview, and jsdom has no `ResizeObserver`.
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            disconnect() {}
        });
    });
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("lands a link in the source and clears it there while no preview shows", async () => {
        const note = buildMarkdownNote();
        const viewScope: ViewScope = { block: "b" };
        const split = mountMarkdown(note, contextOf(note, viewScope));
        const view = createView(400);
        split.showEditor(view);
        expect(revealInSource).not.toHaveBeenCalled();

        split.loadContent("Text");
        expect(revealInSource).toHaveBeenCalledExactlyOnceWith(
            view, viewScope, { isFlashed: true, isConsumed: true }
        );

        // A split that shows the source alone has no preview.
        const sourceOnly = mountMarkdown(note, contextOf(note, viewScope), false);
        expect(sourceOnly.preview).toBeNull();
        const sourceView = createView(400);
        sourceOnly.showEditor(sourceView);
        sourceOnly.loadContent("Text");
        expect(revealInSource).toHaveBeenLastCalledWith(
            sourceView, viewScope, { isFlashed: true, isConsumed: true }
        );

        await nextFrame();
        expect(consumeBookmark).not.toHaveBeenCalled();
        expect(consumeBlockReference).not.toHaveBeenCalled();
    });

    it("lands a link in the source of a split, then in its preview a frame later", async () => {
        const note = buildMarkdownNote();
        const viewScope: ViewScope = { bookmark: "top" };
        const split = mountMarkdown(note, contextOf(note, viewScope));
        setClientHeight(split.preview, 400);
        const view = createView(400);
        split.showEditor(view);
        split.loadContent("Text");

        expect(revealInSource).toHaveBeenCalledExactlyOnceWith(
            view, viewScope, { isFlashed: false, isConsumed: false }
        );
        expect(consumeBookmark).not.toHaveBeenCalled();
        await nextFrame();
        expect(consumeBookmark).toHaveBeenCalledExactlyOnceWith(split.preview, viewScope);
        expect(consumeBlockReference).toHaveBeenCalledExactlyOnceWith(split.preview, viewScope);
    });

    it("lands a link in the preview alone while the source is hidden or not mounted", async () => {
        const note = buildMarkdownNote();
        const viewScope: ViewScope = { block: "b" };
        const hiddenSource = mountMarkdown(note, contextOf(note, viewScope));
        setClientHeight(hiddenSource.preview, 400);
        hiddenSource.showEditor(createView(0));
        hiddenSource.loadContent("Text");
        // In preview mode the editor is not mounted, and the content comes from the blob.
        const noSource = mountMarkdown(note, contextOf(note, viewScope));
        setClientHeight(noSource.preview, 400);
        noSource.loadContent("Text");

        await nextFrame();
        expect(revealInSource).not.toHaveBeenCalled();
        expect(vi.mocked(consumeBlockReference).mock.calls).toEqual([
            [ hiddenSource.preview, viewScope ], [ noSource.preview, viewScope ]
        ]);
    });

    it("lands a link only with a target, and only on the content of its note", () => {
        const [ first, second ] = [ buildMarkdownNote(), buildMarkdownNote() ];
        for (const context of [ undefined, contextOf(first, {}) ]) {
            const split = mountMarkdown(first, context);
            split.showEditor(createView(400));
            split.loadContent("Text");
        }
        expect(revealInSource).not.toHaveBeenCalled();

        // An editor reused for another note keeps the content of the previous one until it loads.
        const viewScope: ViewScope = { block: "b" };
        const split = mountMarkdown(first);
        const view = createView(400);
        split.showEditor(view);
        split.loadContent("First");
        split.show(second, contextOf(second, viewScope));
        expect(revealInSource).not.toHaveBeenCalled();

        split.loadContent("Second");
        expect(revealInSource).toHaveBeenCalledExactlyOnceWith(
            view, viewScope, { isFlashed: true, isConsumed: true }
        );
    });

    it("gives its note, path and preview to the menus of block references", () => {
        const note = buildMarkdownNote();
        const split = mountMarkdown(note, contextOf(note, {}));
        const view = createView(400);
        split.showEditor(view);

        const source = getMarkdownReferenceSource(view);
        expect(split.preview).not.toBeNull();
        expect(source?.getNote()).toBe(note);
        expect(source?.getNotePath()).toBe("root/docs/readme");
        expect(source?.getPreview()).toBe(split.preview);
    });

    it("opens the link dialog over the source with its note and the path it shows", () => {
        const note = buildMarkdownNote();
        const split = mountMarkdown(note, contextOf(note, {}));
        split.commands.addLinkToTextCommand();
        expect(showEditLinkDialog).not.toHaveBeenCalled();

        const view = createView(400);
        split.showEditor(view);
        split.commands.addLinkToTextCommand();
        expect(showEditLinkDialog).toHaveBeenLastCalledWith(
            view, { noteId: note.noteId, notePath: "root/docs/readme" }
        );

        // Without a note context, the dialog gets the best path of the note.
        vi.spyOn(note, "getBestNotePathString").mockReturnValue("root/best");
        const contextless = mountMarkdown(note);
        const contextlessView = createView(400);
        contextless.showEditor(contextlessView);
        contextless.commands.addLinkToTextCommand();
        expect(showEditLinkDialog).toHaveBeenLastCalledWith(
            contextlessView, { noteId: note.noteId, notePath: "root/best" }
        );
    });

    it("cuts the selection into a new note titled by its heading", async () => {
        const note = buildMarkdownNote();
        const child = buildNote({ title: "Setup" });
        const { tabManager } = appContext;
        appContext.tabManager = {
            getActiveContextNote: () => note,
            getActiveContextNotePath: () => "root/docs"
        } as unknown as TabManager;
        const createNote = vi.spyOn(note_create, "createNote").mockResolvedValue(
            { note: child } as unknown as Awaited<ReturnType<typeof note_create.createNote>>
        );
        try {
            const split = mountMarkdown(note);
            const view = createView(400);
            split.showEditor(view);
            const cut = async (doc: string) => {
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: doc },
                    selection: { anchor: 0, head: doc.length }
                });
                await act(() => split.commands.cutIntoNoteCommand());
            };

            await cut(`## Setup <a data-trilium-block-id="s"></a>\n\nRun it.`);
            expect(createNote).toHaveBeenLastCalledWith("root/docs", expect.objectContaining({
                title: "Setup", content: "Run it.", type: "code", mime: "text/x-markdown"
            }));
            expect(view.state.doc.toString()).toBe(`[[${child.noteId}]]`);

            // Without a heading, the selection is the content, and the note has no title.
            await cut("Just text");
            expect(createNote).toHaveBeenLastCalledWith("root/docs", expect.objectContaining({
                title: null, content: "Just text"
            }));
        } finally {
            appContext.tabManager = tabManager;
        }
    });

    describe("links to the headings of the outline", () => {
        const owned = (id: string) => `<a data-trilium-block-id="${id}"></a>`;

        /** The outline that the split last published, with the context it published to. */
        function publishedToc(context: Partial<NoteContext>) {
            const calls = vi.mocked(context.setContextData as (key: string, value: unknown) => void)
                .mock.calls.filter(([ key ]) => key === "toc");
            const toc = calls.at(-1)?.[1] as HeadingContext | undefined;
            if (!toc?.headingLinks) throw new Error("No outline with links was published.");
            return { headings: toc.headings, headingLinks: toc.headingLinks };
        }

        it("gives a heading of the editor a marker, confirmed in the saved note", async () => {
            const note = buildMarkdownNote();
            const context = contextOf(note, {});
            const split = mountMarkdown(note, context);
            const view = createView(400);
            const content = "# Title\n\n## Setup";
            setDoc(view, content);
            split.showEditor(view);
            split.loadContent(content);
            vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
            vi.spyOn(server, "getWithSilentErrors").mockImplementation(async () => ({
                blobId: "b", content: view.state.doc.toString()
            }));

            const { headings, headingLinks } = publishedToc(context);
            expect(headingLinks.hasPublicLinks).toBe(true);
            // The link goes to the path that the rows were published for.
            context.notePath = "root/elsewhere";
            const target = await headingLinks.getTarget(headings[1]);
            await target?.createReference?.();
            const id = target?.params?.block ?? "";
            expect(view.state.doc.toString()).toBe(`${content} ${owned(id)}`);
            expect(target?.createLinkPath()).toBe(`root/docs/readme?block=${id}`);
        });

        it("posts the line of a saved heading, without a writable editor", async () => {
            const note = buildMarkdownNote();
            // The first heading has no text in the browser, and some on the server.
            const content = "## <template>Hidden</template>\n\n"
                + `## Install ${owned("first")}\n\n## Install ${owned("second")}`;
            vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
            const post = vi.spyOn(server, "postWithSilentErrors")
                .mockResolvedValue({ params: { block: "second" } });

            for (const readOnlyView of [ null, createView(400, true) ]) {
                const context = contextOf(note, {});
                const split = mountMarkdown(note, context);
                if (readOnlyView) {
                    setDoc(readOnlyView, content);
                    split.showEditor(readOnlyView);
                }
                split.loadContent(content, "shown");

                const { headings, headingLinks } = publishedToc(context);
                expect(headings).toHaveLength(3);
                const target = await headingLinks.getTarget(headings[2]);
                await target?.createReference?.();
                expect(post).toHaveBeenLastCalledWith(`notes/${note.noteId}/references`, {
                    kind: "heading", line: 5, title: "Install", blobId: "shown"
                });
                expect(target?.createLinkPath()).toBe("root/docs/readme?block=second");
                expect(readOnlyView?.state.doc.toString() ?? content).toBe(content);
            }

            // Content that the editor typed has no blob to post against.
            const context = contextOf(note, {});
            const split = mountMarkdown(note, context);
            split.loadContent(content);
            const { headings, headingLinks } = publishedToc(context);
            expect(await headingLinks.getTarget(headings[2])).toBeNull();
            expect(post).toHaveBeenCalledTimes(2);
        });

        it("has no target for rows of an earlier content or of another note", async () => {
            const note = buildMarkdownNote();
            const context = contextOf(note, {});
            const split = mountMarkdown(note, context);
            const view = createView(400);
            setDoc(view, "## Setup");
            split.showEditor(view);
            split.loadContent("## Setup");
            const first = publishedToc(context);

            // The line moved: the rows published before no longer match.
            setDoc(view, "Intro\n\n## Setup");
            split.loadContent("Intro\n\n## Setup");
            expect(await first.headingLinks.getTarget(first.headings[0])).toBeNull();

            // The editor is reused for another note.
            const second = publishedToc(context);
            const other = buildMarkdownNote();
            split.show(other, contextOf(other, {}));
            split.loadContent("Intro\n\n## Setup");
            expect(await second.headingLinks.getTarget(second.headings[0])).toBeNull();

            // A document that the editor changed since the rows were published.
            const thirdContext = contextOf(note, {});
            const third = mountMarkdown(note, thirdContext);
            const thirdView = createView(400);
            setDoc(thirdView, "## Setup");
            third.showEditor(thirdView);
            third.loadContent("## Setup");
            const rows = publishedToc(thirdContext);
            setDoc(thirdView, "## Setup!");
            expect(await rows.headingLinks.getTarget(rows.headings[0])).toBeNull();
        });
    });
});

/** The commands of the text editor that `Markdown` handles for its parent component. */
interface TextCommands {
    addLinkToTextCommand(): void;
    cutIntoNoteCommand(): Promise<void>;
}

/** Unmounts what the specs of `Markdown` mounted, in order: a component before its editor. */
const cleanups: (() => void)[] = [];
let mountCount = 0;

/**
 * Renders `Markdown` for `note` in a stub of `SplitEditor`, with a preview unless
 * `isPreviewMounted` is false. The split gets its editor and the content of the note from the
 * returned functions, and `show` renders another note in it.
 */
function mountMarkdown(note: FNote, noteContext?: Partial<NoteContext>, isPreviewMounted = true) {
    const ntxId = `ntx-${++mountCount}`;
    if (!isPreviewMounted) {
        splits.withoutPreview.add(ntxId);
    }
    const parent = new Component();
    const container = document.body.appendChild(document.createElement("div"));
    const show = (shown: FNote, context?: Partial<NoteContext>) => {
        act(() => {
            render(h(ParentComponent.Provider, { value: parent }, h(Markdown, {
                note: shown, noteContext: context as NoteContext | undefined,
                viewScope: context?.viewScope, ntxId, parentComponent: undefined, isVisible: true
            })), container);
        });
    };
    show(note, noteContext);
    cleanups.push(() => {
        act(() => render(null, container));
        container.remove();
    });

    const getSplit = () => {
        const props = splits.props.get(ntxId);
        if (!props) throw new Error("Markdown rendered no split.");
        return props;
    };
    return {
        commands: parent as unknown as TextCommands,
        preview: container.querySelector<HTMLElement>(".markdown-preview"),
        show,
        showEditor(view: VanillaCodeMirror) {
            const { editorRef } = getSplit();
            if (typeof editorRef !== "function") throw new Error("Markdown takes no editor.");
            act(() => {
                editorRef(view);
            });
        },
        /** Loads `content`, read from the blob `blobId` unless an editor typed it. */
        loadContent(content: string, blobId?: string) {
            const { onContentChanged } = getSplit();
            act(() => onContentChanged?.(content, blobId));
        }
    };
}

/** A CodeMirror editor whose scroller is `clientHeight` pixels tall, 0 while it is hidden. */
function createView(clientHeight: number, readOnly = false) {
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new VanillaCodeMirror({ parent, readOnly });
    setClientHeight(view.scrollDOM, clientHeight);
    cleanups.push(() => {
        view.destroy();
        parent.remove();
    });
    return view;
}

/** Replaces the document of `view`: `setText()` calls `checkVisibility()`, which jsdom lacks. */
function setDoc(view: VanillaCodeMirror, doc: string) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
}

function setClientHeight(element: HTMLElement | null, clientHeight: number) {
    if (!element) throw new Error("There is no element to size.");
    Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
}

/** The context of a tab that shows `note` at `root/docs/readme` with `viewScope`. */
function contextOf(note: FNote, viewScope: ViewScope): Partial<NoteContext> {
    return {
        noteId: note.noteId, notePath: "root/docs/readme", viewScope, setContextData: vi.fn()
    };
}

function buildMarkdownNote() {
    return buildNote({ title: "Readme", type: "code", mime: "text/x-markdown" });
}

/** Resolves on the next animation frame, after the callbacks requested before. */
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}
