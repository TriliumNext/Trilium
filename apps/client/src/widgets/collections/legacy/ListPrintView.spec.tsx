import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// Per-note HTML the mocked content renderer should produce. Keyed by noteId.
const renderedHtmlByNoteId = new Map<string, string>();

vi.mock("../../../services/content_renderer", () => ({
    default: {
        getRenderedContent: vi.fn(async (note: { noteId: string }) => {
            const el = document.createElement("div");
            el.className = "rendered-content";
            el.innerHTML = renderedHtmlByNoteId.get(note.noteId) ?? "";
            // The component only ever reads `content.$renderedContent[0]`.
            return { $renderedContent: [el] };
        })
    }
}));

vi.mock("../../../services/protected_session_holder", () => ({
    default: {
        isProtectedSessionAvailable: vi.fn(() => true),
        touchProtectedSessionIfNecessary: vi.fn()
    }
}));

import froca from "../../../services/froca";
import protected_session_holder from "../../../services/protected_session_holder";
import { buildNote } from "../../../test/easy-froca";
import { flush } from "../../../test/render-hook";
import { ListPrintView } from "./ListPrintView";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderView(props: Record<string, unknown>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => render(<ListPrintView {...(props as any)} />, container));
    return container;
}

type AnyFn = ReturnType<typeof vi.fn>;

/** Builds the full set of props `ViewModeProps` requires, overlaying the relevant ones. */
function makeProps(overrides: Record<string, unknown>) {
    return {
        notePath: "root",
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "print" as const,
        onReady: vi.fn(),
        ...overrides
    };
}

beforeEach(() => {
    renderedHtmlByNoteId.clear();
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    (protected_session_holder.isProtectedSessionAvailable as AnyFn).mockReturnValue(true);
});

afterEach(async () => {
    await act(async () => {});
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("ListPrintView", () => {
    it("renders the parent title and a sanitized section per printable child note", async () => {
        renderedHtmlByNoteId.set("child1", "<p>Hello one</p>");
        renderedHtmlByNoteId.set("child2", "<p>Hello two</p>");
        const parent = buildNote({
            id: "parent", title: "Parent Title",
            children: [
                { id: "child1", title: "Child One" },
                { id: "child2", title: "Child Two" }
            ]
        });

        const onReady = vi.fn();
        const onProgressChanged = vi.fn();
        const root = renderView(makeProps({
            note: parent, noteIds: [ "child1", "child2" ], onReady, onProgressChanged
        }));
        await flush();

        // The static heading uses the parent note's title.
        expect(root.querySelector("h1")?.textContent).toBe("Parent Title");

        // One <section> per printable note, with the deterministic id.
        const sections = root.querySelectorAll("section.note");
        expect(sections.length).toBe(2);
        expect(sections[0]?.id).toBe("note-child1");
        expect(sections[1]?.id).toBe("note-child2");

        // insertPageTitle prepends an <h1>(child title); rewriteHeadings(depth=1) then bumps it to <h2>.
        expect(sections[0]?.innerHTML).toContain("<h2>Child One</h2>");
        expect(sections[0]?.innerHTML).toContain("Hello one");

        // Progress was reported and onReady fired with the collection report.
        expect(onProgressChanged).toHaveBeenCalled();
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledWith({ type: "collection", ignoredNoteIds: [] });
    });

    it("recurses into grandchildren and reports them as printed sections", async () => {
        renderedHtmlByNoteId.set("c", "<p>c</p>");
        renderedHtmlByNoteId.set("gc", "<p>gc</p>");
        const parent = buildNote({
            id: "parent", title: "P",
            children: [
                { id: "c", title: "C", children: [ { id: "gc", title: "GC" } ] }
            ]
        });

        const root = renderView(makeProps({ note: parent, noteIds: [ "c" ] }));
        await flush();

        const ids = Array.from(root.querySelectorAll("section.note")).map((s) => s.id);
        expect(ids).toEqual([ "note-c", "note-gc" ]);
    });

    it("collects ignored note IDs for file-type and protected (no session) notes", async () => {
        renderedHtmlByNoteId.set("ok", "<p>ok</p>");
        const parent = buildNote({
            id: "parent", title: "P",
            children: [
                { id: "ok", title: "Ok" },
                { id: "filenote", title: "File", type: "file" },
                { id: "protnote", title: "Protected" }
            ]
        });
        // Force the protected note to be unavailable.
        const protNote = froca.notes["protnote"];
        if (protNote) {
            protNote.isProtected = true;
        }
        (protected_session_holder.isProtectedSessionAvailable as AnyFn).mockReturnValue(false);

        const onReady = vi.fn();
        const root = renderView(makeProps({
            note: parent, noteIds: [ "ok", "filenote", "protnote" ], onReady
        }));
        await flush();

        // Only the printable note becomes a section.
        const sections = root.querySelectorAll("section.note");
        expect(sections.length).toBe(1);
        expect(sections[0]?.id).toBe("note-ok");

        // The two non-printable notes are reported as ignored.
        expect(onReady).toHaveBeenCalledTimes(1);
        const report = onReady.mock.calls[0]?.[0];
        expect(report?.type).toBe("collection");
        expect(new Set(report?.ignoredNoteIds)).toEqual(new Set([ "filenote", "protnote" ]));
    });

    it("rewrites headings by depth and caps the level at h6", async () => {
        // depth for top-level notes is 1, so h1->h2, h5->h6, h6->h6 (capped).
        renderedHtmlByNoteId.set("c", "<h1>A</h1><h5>B</h5><h6>C</h6>");
        const parent = buildNote({
            id: "parent", title: "P", children: [ { id: "c", title: "C" } ]
        });

        const root = renderView(makeProps({ note: parent, noteIds: [ "c" ] }));
        await flush();

        const section = root.querySelector("section.note");
        // The prepended page-title h1 ("C") is also present, so query the originals by text.
        const html = section?.innerHTML ?? "";
        expect(html).toContain("<h2>A</h2>");
        expect(html).toContain("<h6>B</h6>");
        expect(html).toContain("<h6>C</h6>");
    });

    it("rewrites internal links: in-set hrefs become anchors, out-of-set links lose the anchor, externals untouched", async () => {
        // child1 links to child2 (in-set), to an absent note, and to an external URL; one anchor has no href.
        renderedHtmlByNoteId.set(
            "child1",
            `<a href="#root/child2">to-two</a>` +
            `<a href="#root/missing">to-missing</a>` +
            `<a href="https://example.com">external</a>` +
            `<a>no-href</a>`
        );
        renderedHtmlByNoteId.set("child2", "<p>two</p>");
        const parent = buildNote({
            id: "parent", title: "P",
            children: [
                { id: "child1", title: "C1" },
                { id: "child2", title: "C2" }
            ]
        });

        const root = renderView(makeProps({ note: parent, noteIds: [ "child1", "child2" ] }));
        await flush();

        const section1 = root.querySelector("#note-child1");
        const html = section1?.innerHTML ?? "";

        // In-set link rewritten to the local anchor.
        expect(html).toContain(`href="#note-child2"`);
        // Out-of-set link replaced by a <span> keeping the text, no anchor to #root/missing.
        expect(html).not.toContain("#root/missing");
        expect(html).toContain("to-missing");
        // External link preserved as-is.
        expect(html).toContain(`href="https://example.com"`);
        expect(html).toContain("external");
        // The bare anchor (no href) survives untouched.
        expect(html).toContain("no-href");
    });

    it("filters out imageLink/includeNoteLink targets and the _hidden note from the rendered set", async () => {
        renderedHtmlByNoteId.set("real", "<p>real</p>");
        renderedHtmlByNoteId.set("img", "<p>img</p>");
        renderedHtmlByNoteId.set("inc", "<p>inc</p>");
        renderedHtmlByNoteId.set("_hidden", "<p>hidden</p>");
        // Build the linked targets so froca.getNotes never hits the server.
        buildNote({ id: "real", title: "Real" });
        buildNote({ id: "img", title: "Img" });
        buildNote({ id: "inc", title: "Inc" });
        buildNote({ id: "_hidden", title: "Hidden" });
        const parent = buildNote({
            id: "parent", title: "P",
            "~imageLink": "img",
            "~includeNoteLink": "inc"
        });

        const root = renderView(makeProps({
            note: parent, noteIds: [ "real", "img", "inc", "_hidden" ]
        }));
        await flush();

        const ids = Array.from(root.querySelectorAll("section.note")).map((s) => s.id);
        expect(ids).toEqual([ "note-real" ]);
    });

    it("excludes imageLink children from recursion via filterChildNotes", async () => {
        renderedHtmlByNoteId.set("c", "<p>c</p>");
        renderedHtmlByNoteId.set("imgchild", "<p>imgchild</p>");
        renderedHtmlByNoteId.set("plainchild", "<p>plainchild</p>");
        const parent = buildNote({
            id: "parent", title: "P",
            children: [
                {
                    id: "c", title: "C",
                    "~imageLink": "imgchild",
                    children: [
                        { id: "imgchild", title: "ImgChild" },
                        { id: "plainchild", title: "PlainChild" }
                    ]
                }
            ]
        });

        const root = renderView(makeProps({ note: parent, noteIds: [ "c" ] }));
        await flush();

        const ids = Array.from(root.querySelectorAll("section.note")).map((s) => s.id);
        // c and its plain child are printed; the imageLink child is skipped.
        expect(ids).toEqual([ "note-c", "note-plainchild" ]);
    });

    it("does not call onReady when none is provided", async () => {
        renderedHtmlByNoteId.set("c", "<p>c</p>");
        const parent = buildNote({
            id: "parent", title: "P", children: [ { id: "c", title: "C" } ]
        });

        // onReady omitted entirely; the effect's guard should skip the call without throwing.
        const root = renderView({
            note: parent,
            notePath: "root",
            noteIds: [ "c" ],
            highlightedTokens: null,
            viewConfig: undefined,
            saveConfig: vi.fn(),
            media: "print"
        });
        await flush();

        expect(root.querySelectorAll("section.note").length).toBe(1);
    });
});
