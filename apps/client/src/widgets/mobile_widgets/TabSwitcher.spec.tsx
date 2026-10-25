import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import froca from "../../services/froca";
import { buildNotes } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { setTabScreen, setTabTree } from "./tab_navigation";
import { getSwipeDirection, switchTabWithSlide, Tab, useTabSwipe } from "./TabSwitcher";

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

describe("tab swipe", () => {
    beforeEach(() => {
        glob.isRtl = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("takes a long, level swipe toward the start for the next tab", () => {
        expect(getSwipeDirection(-40, 5, false)).toBe("next");
        expect(getSwipeDirection(40, 5, false)).toBe("previous");
        expect(getSwipeDirection(40, 5, true)).toBe("next");
        expect(getSwipeDirection(-20, 0, false)).toBeUndefined();
        expect(getSwipeDirection(-40, 30, false)).toBeUndefined();
    });

    it("slides the content while the tab switches, and switches at once without view transitions", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const slides: (string | undefined)[] = [];
        // The browser renders no frames while a view transition updates the page, and rejects
        // `ready` when it skips the animation.
        vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
        document.startViewTransition = ((update: () => Promise<void>) => {
            slides.push(document.documentElement.dataset.tabSlide);
            return { finished: update(), ready: Promise.reject(new DOMException("Skipped", "AbortError")) };
        }) as unknown as typeof document.startViewTransition;

        await switchTabWithSlide("next");
        await switchTabWithSlide("previous");
        expect(slides).toEqual([ "left", "right" ]);
        expect(triggerCommand.mock.calls.map(([ name ]) => name)).toEqual([ "activateNextTab", "activatePreviousTab" ]);
        expect(document.documentElement.dataset.tabSlide).toBeUndefined();

        Reflect.deleteProperty(document, "startViewTransition");
        await switchTabWithSlide("next");
        expect(triggerCommand).toHaveBeenLastCalledWith("activateNextTab");
        expect(slides).toHaveLength(2);
    }, 1000);

    it("switches tabs on a swipe across the button, whose click then is not a tap", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const onTap = vi.fn();
        function SwipeButton({ enabled }: { enabled: boolean }) {
            const swipe = useTabSwipe(enabled);
            return <button
                onClick={() => !swipe.takeSwipe() && onTap()}
                onPointerDown={swipe.onPointerDown}
                onPointerMove={swipe.onPointerMove}
                onPointerUp={swipe.onPointerEnd}
            />;
        }
        const press = (button: HTMLButtonElement, moves: number[]) => {
            const send = (type: string, clientX: number) => button.dispatchEvent(
                new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 1, clientX, clientY: 10 }));
            send("pointerdown", 100);
            for (const clientX of moves) send("pointermove", clientX);
            send("pointerup", moves.at(-1) ?? 100);
            button.click();
        };

        const button = renderInto(<SwipeButton enabled />).querySelector("button");
        if (!button) throw new Error("No button");
        press(button, [ 90, 60, 20 ]);
        expect(triggerCommand.mock.calls).toEqual([ [ "activateNextTab" ] ]);
        expect(onTap).not.toHaveBeenCalled();

        press(button, []);
        expect(onTap).toHaveBeenCalledTimes(1);
        expect(triggerCommand).toHaveBeenCalledTimes(1);

        const single = renderInto(<SwipeButton enabled={false} />).querySelector("button");
        if (!single) throw new Error("No button");
        press(single, [ 20 ]);
        expect(triggerCommand).toHaveBeenCalledTimes(1);
        expect(onTap).toHaveBeenCalledTimes(2);
    });
});
