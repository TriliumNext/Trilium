import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { buildNotes } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { setTabScreen, setTabTree } from "./tab_navigation";
import { Tab } from "./TabSwitcher";

describe("Tab", () => {
    buildNotes([
        { id: "folder", title: "Folder", children: [
            { id: "first", title: "First" },
            { id: "second", title: "Second" }
        ] },
        { id: "collection", title: "Collection", "#subtreeHidden": "", children: [
            { id: "shown", title: "Shown" },
            { id: "spotlit", title: "Spotlit" }
        ] }
    ]);

    let isNarrow: boolean;

    beforeEach(() => {
        isNarrow = true;
        vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
            matches: isNarrow && query === "(max-width: 991px)",
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        }) as unknown as MediaQueryList);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderTab(ntxId: string) {
        const noteContext = {
            ntxId,
            note: froca.getNoteFromCache("second"),
            notePath: "root/folder/second",
            isMainContext: () => true,
            getNavigationTitle: async () => null
        } as unknown as NoteContext;
        noteContext.getSubContexts = () => [ noteContext ];

        const container = renderInto(<Tab noteContext={noteContext} containerRef={() => {}} selectTab={() => {}} activeNtxId={ntxId} />);
        await act(async () => {});
        return container;
    }

    it("shows the tree column a tab was left on, with the tab's note highlighted", async () => {
        setTabTree("on-tree", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/folder" ] });
        setTabScreen("on-tree", "tree");

        const card = await renderTab("on-tree");
        expect(card.querySelectorAll("header")).toHaveLength(1);
        expect(card.querySelector("header .title")?.textContent).toBe("Folder");
        const rows = await vi.waitFor(() => {
            const rows = [ ...card.querySelectorAll(".tab-preview.type-tree .tree-row") ];
            expect(rows).toHaveLength(2);
            return rows;
        });
        expect(rows.map((row) => row.textContent)).toEqual([ "First", "Second" ]);
        expect(rows.map((row) => row.classList.contains("active"))).toEqual([ false, true ]);
        expect(card.querySelector(".tab-preview-placeholder")).toBeNull();
    });

    it("lists only the child on the tab's note path in a column whose subtree is hidden", async () => {
        setTabTree("in-collection", { notePath: "root/collection/spotlit", hoistedNoteId: "root", stack: [ "root", "root/collection" ] });
        setTabScreen("in-collection", "tree");

        const card = await renderTab("in-collection");
        const rows = await vi.waitFor(() => {
            const rows = [ ...card.querySelectorAll(".tab-preview.type-tree .tree-row") ];
            expect(rows).toHaveLength(1);
            return rows;
        });
        expect(rows[0].textContent).toBe("Spotlit");
        expect(rows[0].classList.contains("active")).toBe(true);
        expect(card.querySelector(".tab-preview-placeholder")).toBeNull();

        setTabTree("off-collection", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/collection" ] });
        setTabScreen("off-collection", "tree");
        const offCard = await renderTab("off-collection");
        expect(offCard.querySelector(".tab-preview-placeholder")).not.toBeNull();
        expect(offCard.querySelectorAll(".tree-row")).toHaveLength(0);
    });

    it("shows the note of a tab left on it, and on a tablet whatever the tab was left on", async () => {
        setTabTree("on-note", { notePath: "root/folder/second", hoistedNoteId: "root", stack: [ "root", "root/folder" ] });
        setTabScreen("on-note", "detail");
        expect((await renderTab("on-note")).querySelector("header .title")?.textContent).toBe("Second");

        isNarrow = false;
        setTabScreen("on-note", "tree");
        const card = await renderTab("on-note");
        expect(card.querySelector("header .title")?.textContent).toBe("Second");
        expect(card.querySelector(".type-tree")).toBeNull();
    });
});
