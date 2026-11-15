import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted: a module in the import chain reads the device once as it loads (see ActionButton), which
// happens before a plain `const` here would have been initialized.
const isMobileMock = vi.hoisted(() => vi.fn(() => false));
// The button asks the device what it is at render time; mock it so both halves of the split can be
// rendered here, whichever machine the tests are run on.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
}));

// Raising the picker's dialog for real would need Bootstrap; what is asked of it is the point here.
const openDialogMock = vi.hoisted(() => vi.fn(async (dialog: JQuery<HTMLElement>, _closeActDialog?: boolean) => dialog));
vi.mock("../../services/dialog", () => ({ openDialog: openDialogMock }));

// The grid asks the server for every icon, and for which icons the tree already uses, to lead with
// those. Anything else asked of the server here is a module loading beside the picker, and wants a
// list back.
const iconRegistryMock = vi.hoisted(() => ({ sources: [] as { prefix: string, name: string, icon: string, icons: { id: string, terms: string[] }[] }[] }));
vi.mock("../../services/server", () => ({
    default: {
        get: async (url: string) => {
            if (url === "other/icon-usage") return { iconClassToCountMap: {} };
            if (url === "other/icon-registry") return iconRegistryMock;
            return [];
        }
    }
}));

// The grid is virtualized; a stub tells how many rows of icons it was handed.
vi.mock("react-window", () => ({
    Grid: ({ rowCount }: { rowCount: number }) => <div className="icon-grid-stub" data-rows={rowCount} />
}));

import { renderInto } from "../../test/render";
import IconPicker from "./IconPicker";
import { IconPickerButton } from "./IconPickerButton";

describe("IconPickerButton", () => {
    beforeEach(() => {
        // Opening builds the grid, which reads the installed packs off the page.
        glob.iconPacks = [];
    });

    /** Renders the button as the given device would see it. */
    function renderButton(mobile: boolean) {
        isMobileMock.mockReturnValue(mobile);
        return renderInto(
            <IconPickerButton icon="bx bx-star" title="Change this icon" onSelect={() => {}} />
        );
    }

    it("hangs the picker under the button on a desktop, and gives it a screen of its own on a phone", async () => {
        const desktop = renderButton(false);

        // The button stands where it was put; what it opens is a menu, which is neither built nor
        // handed to the page until it is opened.
        expect(desktop.querySelector(".note-icon-widget button.note-icon")).toBeTruthy();
        expect(document.body.querySelector(".modal.icon-switcher")).toBeNull();
        expect(document.body.querySelector(".dropdown-menu")).toBeNull();

        const mobile = renderButton(true);

        // A menu at the width of the picker is wider than a phone, so what opens there is the modal
        // the note's own icon is picked through, which the stylesheet gives the whole screen to.
        const mobileButton = mobile.querySelector<HTMLElement>(".note-icon-widget button.note-icon");
        expect(mobileButton).toBeTruthy();
        // The modal comes with the picker's module, which loads once the button is about to be
        // pressed, and is rendered from the first press.
        // Long enough for a modal that came with the button to have rendered.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
        expect(document.body.querySelector(".modal.icon-switcher")).toBeNull();
        act(() => { mobileButton?.dispatchEvent(new PointerEvent("pointerenter")); });
        act(() => { mobileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await vi.waitFor(() => expect(document.body.querySelector(".modal.icon-switcher")).toBeTruthy());
        expect(document.body.querySelector(".dropdown-menu")).toBeNull();

    });

    /**
     * The button heads a note, and a title row is often a dialog's own header — the geo map's marker
     * sheet, the quick editor. A picker that closed the active dialog closed the one it was rendered
     * inside, taking itself down with it and leaving the backdrop over an empty page.
     */
    it("opens the picker on a phone without closing the dialog it stands in", async () => {
        const mobile = renderButton(true);
        openDialogMock.mockClear();

        const button = mobile.querySelector<HTMLElement>(".note-icon-widget button.note-icon");
        expect(button).toBeTruthy();
        act(() => {
            button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        await vi.waitFor(() => expect(openDialogMock).toHaveBeenCalledOnce());
        // The `closeActDialog` argument, which is what stands a dialog down to make room.
        expect(openDialogMock.mock.calls[0][1]).toBe(false);
    });
});

describe("IconPicker", () => {
    it("lists the icons the server returns, which `/bootstrap` leaves out", async () => {
        glob.iconPacks = [ { prefix: "bx", name: "Boxicons", icon: "bx bx-box" } ];
        iconRegistryMock.sources = [ {
            prefix: "bx", name: "Boxicons", icon: "bx bx-box",
            icons: [ { id: "bx bx-star", terms: [ "star" ] }, { id: "bx bx-heart", terms: [ "heart" ] } ]
        } ];

        const picker = renderInto(<IconPicker columnCount={1} onSelect={() => {}} />);
        expect(picker.querySelector(".no-results")).not.toBeNull();
        await vi.waitFor(() => expect(picker.querySelector(".icon-grid-stub")?.getAttribute("data-rows")).toBe("2"));
        iconRegistryMock.sources = [];
    });


    it("draws the compact grid smaller than the one a note's icon is picked from", () => {
        glob.iconPacks = [];

        const regular = renderInto(<IconPicker columnCount={9} onSelect={() => {}} />);
        const compact = renderInto(<IconPicker columnCount={9} compact onSelect={() => {}} />);

        const regularList = regular.querySelector<HTMLElement>(".icon-picker:not(.compact) .icon-list");
        const compactList = compact.querySelector<HTMLElement>(".icon-picker.compact .icon-list");
        expect(regularList).toBeTruthy();
        expect(compactList).toBeTruthy();

        // Nine columns of the compact cell, plus 10px and the inset the stylesheet sets.
        expect(compactList?.style.width).toBe("calc(370px + var(--icon-list-inset))");
        // Eight rows and a quarter, the quarter being what tells the reader there is more below.
        expect(compactList?.style.height).toBe("330px");

        // The regular grid keeps the height the stylesheet gives it, which follows the screen.
        expect(regularList?.style.width).toBe("calc(442px + var(--icon-list-inset))");
        expect(regularList?.style.height).toBe("");
    });
});
