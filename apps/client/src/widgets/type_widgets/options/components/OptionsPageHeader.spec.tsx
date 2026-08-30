import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

const mocks = vi.hoisted(() => ({
    note: undefined as { title: string; getIcon: () => string } | undefined
}));

vi.mock("../../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../react/hooks")>()),
    useNoteContext: () => ({ note: mocks.note })
}));

import OptionsPageHeader, { PageHelpSlot } from "./OptionsPageHeader";

const NOTE = { title: "Appearance", getIcon: () => "bx bx-palette" };

describe("OptionsPageHeader", () => {
    it("names the page and shows the icon the note carries", () => {
        mocks.note = NOTE;
        const container = renderInto(<OptionsPageHeader />);

        expect(container.querySelector(".options-page-header-title")?.textContent).toBe("Appearance");
        expect(container.querySelector(".options-page-header-icon")?.className).toContain("bx-palette");
    });

    it("marks itself as carrying nothing but the name, which a phone shows elsewhere", () => {
        mocks.note = NOTE;
        const bare = renderInto(<OptionsPageHeader />);
        expect(bare.querySelector(".options-page-header")?.className).toContain("options-page-header-title-only");

        // Once it carries something of the page's own it is a band in its own right.
        const withActions = renderInto(<OptionsPageHeader actions={<button>Reset</button>} />);
        expect(withActions.querySelector(".options-page-header")?.className)
            .not.toContain("options-page-header-title-only");
    });

    it("keeps the page's own controls on the title row and its second row beneath", () => {
        mocks.note = NOTE;
        const container = renderInto(
            <OptionsPageHeader actions={<button name="reset">Reset</button>} below={<input name="filter" />} />
        );

        expect(container.querySelector(".options-page-header-actions button[name='reset']")).not.toBeNull();
        expect(container.querySelector(".options-page-header-below input[name='filter']")).not.toBeNull();
    });

    it("offers page-level help beside the name, told apart from the name it stands next to", () => {
        mocks.note = NOTE;
        const container = renderInto(<OptionsPageHeader helpUrl="cbkrhQjrkKrh" />);

        expect(container.querySelector(".options-page-header-help")).not.toBeNull();
    });

    it("hands the help over to a host that has somewhere better for it, rather than drawing it", () => {
        mocks.note = NOTE;
        const taken: (string | undefined)[] = [];
        let container!: HTMLElement;

        // Handed over from an effect, which `renderInto` alone leaves pending.
        act(() => {
            container = renderInto(
                <PageHelpSlot.Provider value={(helpUrl) => taken.push(helpUrl)}>
                    <OptionsPageHeader helpUrl="cbkrhQjrkKrh" />
                </PageHelpSlot.Provider>
            );
        });

        expect(taken).toContain("cbkrhQjrkKrh");
        // Drawn in one place or the other, never in both.
        expect(container.querySelector(".options-page-header-help")).toBeNull();
    });

    it("renders nothing at all before the note has arrived and with nothing else to show", () => {
        mocks.note = undefined;
        expect(renderInto(<OptionsPageHeader />).innerHTML).toBe("");

        // ...but a page that feeds it controls still gets its band, note or no note.
        expect(renderInto(<OptionsPageHeader below={<input />} />).innerHTML).not.toBe("");
    });
});
