import { describe, expect, it, vi } from "vitest";

const activeContext = vi.hoisted(() => ({ hoistedNoteId: "root" as string | undefined }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useActiveNoteContext: () => ({ hoistedNoteId: activeContext.hoistedNoteId })
}));

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ShowAllNotesButton from "./show_all_notes_button";

describe("ShowAllNotesButton", () => {
    function renderButton(hoistedNoteId: string | undefined) {
        activeContext.hoistedNoteId = hoistedNoteId;
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined);
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <ShowAllNotesButton />
            </ParentComponent.Provider>
        );
        const wrapper = container.querySelector(".show-all-notes");
        return { wrapper, button: wrapper?.querySelector("button"), triggerCommand };
    }

    it("keeps a hidden wrapper and no button while nothing is hoisted", () => {
        for (const hoistedNoteId of [ "root", undefined ]) {
            const { wrapper, button } = renderButton(hoistedNoteId);
            expect(wrapper?.classList.contains("hidden-ext")).toBe(true);
            expect(button).toBeNull();
        }
    });

    it("shows a low-profile button that unhoists while a note is hoisted", () => {
        const { wrapper, button, triggerCommand } = renderButton("workspace1");
        expect(wrapper?.classList.contains("hidden-ext")).toBe(false);
        expect(button?.classList.contains("tn-low-profile")).toBe(true);
        expect(button?.querySelector(".bx-arrow-back")).not.toBeNull();

        button?.click();
        expect(triggerCommand).toHaveBeenCalledWith("unhoist", expect.anything());
    });
});
