import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

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

import { renderInto } from "../../test/render";
import { IconPickerButton } from "./IconPicker";

describe("IconPickerButton", () => {
    /** Renders the button as the given device would see it. */
    function renderButton(mobile: boolean) {
        isMobileMock.mockReturnValue(mobile);
        return renderInto(
            <IconPickerButton icon="bx bx-star" title="Change this icon" onSelect={() => {}} />
        );
    }

    it("hangs the picker under the button on a desktop, and gives it a screen of its own on a phone", () => {
        const desktop = renderButton(false);

        // The button stands where it was put; what it opens is a menu, which is neither built nor
        // handed to the page until it is opened (see `portalToBody`).
        expect(desktop.querySelector(".note-icon-widget button.note-icon")).toBeTruthy();
        expect(document.body.querySelector(".modal.icon-switcher")).toBeNull();
        expect(document.body.querySelector(".dropdown-menu")).toBeNull();

        const mobile = renderButton(true);

        // A menu at the width of the picker is wider than a phone, so what opens there is the modal
        // the note's own icon is picked through, which the stylesheet gives the whole screen to.
        expect(mobile.querySelector(".note-icon-widget button.note-icon")).toBeTruthy();
        expect(document.body.querySelector(".modal.icon-switcher")).toBeTruthy();
        expect(document.body.querySelector(".dropdown-menu")).toBeNull();

        // On either device the picker itself waits to be asked for: it holds every icon of every
        // installed pack, which is far more work than a button on screen should be doing.
        expect(document.body.querySelector(".icon-picker")).toBeNull();
    });

    /**
     * The button heads a note, and a title row is often a dialog's own header — the geo map's marker
     * sheet, the quick editor. A picker that closed the active dialog closed the one it was rendered
     * inside, taking itself down with it and leaving the backdrop over an empty page.
     */
    it("opens the picker on a phone without closing the dialog it stands in", () => {
        // Opening builds the grid, which reads the installed packs off the page.
        glob.iconRegistry = { sources: [] };

        const mobile = renderButton(true);
        openDialogMock.mockClear();

        const button = mobile.querySelector<HTMLElement>(".note-icon-widget button.note-icon");
        expect(button).toBeTruthy();
        act(() => {
            button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(openDialogMock).toHaveBeenCalledOnce();
        // The `closeActDialog` argument, which is what stands a dialog down to make room.
        expect(openDialogMock.mock.calls[0][1]).toBe(false);
    });
});
