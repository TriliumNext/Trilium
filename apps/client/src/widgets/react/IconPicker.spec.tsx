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
});
