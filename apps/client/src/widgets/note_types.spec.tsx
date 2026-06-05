import { isValidElement } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mock every dynamically imported type-widget module ------------------------------------------
// The real modules pull in heavy dependencies (ckeditor, mermaid, codemirror, llm services, ...).
// We only need each `import()` to resolve to *something*, so the `view` arrow body executes for
// line coverage without dragging in the real (and side-effectful) implementations.

function stub() {
    return () => null;
}

vi.mock("./type_widgets/Empty", () => ({ default: stub() }));
vi.mock("./type_widgets/Doc", () => ({ default: stub() }));
vi.mock("./type_widgets/ProtectedSession", () => ({ default: stub() }));
vi.mock("./type_widgets/Book", () => ({ default: stub() }));
vi.mock("./type_widgets/ContentWidget", () => ({ default: stub() }));
vi.mock("./type_widgets/WebView", () => ({ default: stub() }));
vi.mock("./type_widgets/File", () => ({ default: stub() }));
vi.mock("./type_widgets/Image", () => ({ default: stub() }));
vi.mock("./type_widgets/code/Code", () => ({ ReadOnlyCode: stub(), EditableCode: stub() }));
vi.mock("./type_widgets/mermaid/Mermaid", () => ({ default: stub() }));
vi.mock("./type_widgets/MindMap", () => ({ default: stub() }));
vi.mock("./type_widgets/Attachment", () => ({ AttachmentList: stub(), AttachmentDetail: stub() }));
vi.mock("./type_widgets/text/ReadOnlyText", () => ({ default: stub() }));
vi.mock("./type_widgets/text/EditableText", () => ({ default: stub() }));
vi.mock("./type_widgets/Render", () => ({ default: stub() }));
vi.mock("./type_widgets/canvas/Canvas", () => ({ default: stub() }));
vi.mock("./type_widgets/relation_map/RelationMap", () => ({ default: stub() }));
vi.mock("./type_widgets/NoteMap", () => ({ default: stub() }));
vi.mock("./type_widgets/SqlConsole", () => ({ default: stub() }));
vi.mock("./type_widgets/code/Markdown", () => ({ default: stub() }));
vi.mock("./type_widgets/spreadsheet/Spreadsheet", () => ({ default: stub() }));
vi.mock("./type_widgets/llm_chat/LlmChat", () => ({ default: stub() }));

import { ExtendedNoteType, TYPE_MAPPINGS, TypeWidget } from "./note_types";

afterEach(() => {
    vi.restoreAllMocks();
});

const allTypes = Object.keys(TYPE_MAPPINGS) as ExtendedNoteType[];

describe("TYPE_MAPPINGS", () => {
    it("defines a mapping for every extended note type with a non-empty className and a view factory", () => {
        expect(allTypes.length).toBeGreaterThan(0);
        for (const type of allTypes) {
            const mapping = TYPE_MAPPINGS[type];
            expect(typeof mapping.className).toBe("string");
            expect(mapping.className.length).toBeGreaterThan(0);
            expect(typeof mapping.view).toBe("function");
        }
    });

    it("marks the expected full-height and printable types", () => {
        // A representative full-height type and a representative non-full-height type.
        expect(TYPE_MAPPINGS.webView.isFullHeight).toBe(true);
        expect(TYPE_MAPPINGS.empty.isFullHeight).toBeUndefined();

        // Some printable, some not.
        expect(TYPE_MAPPINGS.empty.printable).toBe(true);
        expect(TYPE_MAPPINGS.protectedSession.printable).toBeUndefined();
        expect(TYPE_MAPPINGS.sqlConsole.printable).toBeUndefined();
        expect(TYPE_MAPPINGS.readOnlyText.printable).toBeUndefined();
    });

    it("exposes unique className values per mapping", () => {
        const classNames = allTypes.map((type) => TYPE_MAPPINGS[type].className);
        const unique = new Set(classNames);
        expect(unique.size).toBe(classNames.length);
    });
});

describe("TYPE_MAPPINGS view factories", () => {
    async function resolveWidget(view: () => unknown): Promise<TypeWidget | undefined> {
        const raw = view();
        const result = await Promise.resolve(raw);
        if (result && typeof result === "object" && "default" in result) {
            return (result as { default: TypeWidget }).default;
        }
        return result as TypeWidget;
    }

    it("invokes every view factory and resolves to a usable widget (covers each lazy import line)", async () => {
        for (const type of allTypes) {
            const widget = await resolveWidget(TYPE_MAPPINGS[type].view);
            // Each resolved widget is either a component function or a VNode.
            const ok = typeof widget === "function" || isValidElement(widget);
            expect(ok).toBe(true);
        }
    });

    it("resolves the named-export views (code / attachments) to functions", async () => {
        for (const type of [ "readOnlyCode", "editableCode", "attachmentList", "attachmentDetail" ] as ExtendedNoteType[]) {
            const widget = await resolveWidget(TYPE_MAPPINGS[type].view);
            expect(typeof widget).toBe("function");
        }
    });

    it("returns an inline component for the search type that renders a fragment", () => {
        const view = TYPE_MAPPINGS.search.view();
        expect(typeof view).toBe("function");
        if (typeof view === "function") {
            // The search view is `() => (props) => <></>`: calling the inner component yields a fragment VNode.
            const rendered = (view as (props: unknown) => unknown)({});
            expect(isValidElement(rendered)).toBe(true);
        }
    });
});
