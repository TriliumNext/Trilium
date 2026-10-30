import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

const setLabelMock = vi.fn();
const removeOwnedLabelByNameMock = vi.fn();
vi.mock("../../../services/attributes", () => ({
    default: {
        setLabel: (...args: unknown[]) => setLabelMock(...args),
        removeOwnedLabelByName: (...args: unknown[]) => removeOwnedLabelByNameMock(...args)
    }
}));

import appContext from "../../../components/app_context";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { DEFAULT_COLOR_PALETTE } from "../../react/ColorPicker";
import type { PresentationSlideBaseModel } from "./model";
import PresentationToolbarActions, { canPickSlideBackground, SlideBackgroundPicker } from "./toolbar";

describe("SlideBackgroundPicker", () => {
    it("shows the slide's color and writes a pick or a reset to #slide:background", () => {
        const note = buildNote({ title: "Slide", "#slide:background": DEFAULT_COLOR_PALETTE[2] });
        const container = renderPicker(note);

        const selected = getPresetCells(container).filter(cell => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[2]);

        getPresetCells(container)[4].click();
        expect(setLabelMock).toHaveBeenLastCalledWith(note.noteId, "slide:background", DEFAULT_COLOR_PALETTE[4]);

        container.querySelector<HTMLElement>(".color-cell-reset")?.click();
        expect(removeOwnedLabelByNameMock).toHaveBeenLastCalledWith(note, "slide:background");
    });

    it("selects no color for a gradient background", () => {
        const note = buildNote({ title: "Slide", "#slide:background": "linear-gradient(red, blue)" });
        const container = renderPicker(note);

        expect(container.querySelectorAll(".color-cell.selected")).toHaveLength(0);
    });
});

describe("the edit button", () => {
    function clickEdit(slide: PresentationSlideBaseModel, onEditInPlace: ((noteId: string) => void) | undefined) {
        const container = renderInto(<PresentationToolbarActions
            onStartPresentation={vi.fn()}
            api={undefined}
            hasSlides
            isEditing={false}
            onFinishEditing={vi.fn()}
            onNewSlide={undefined}
            backgroundSlide={undefined}
            slideToEdit={{ slide, onEditInPlace }}
        />);
        const button = container.querySelector<HTMLButtonElement>("button.bx-edit");
        expect(button).not.toBeNull();
        act(() => button?.click());
    }

    it("edits a text or canvas slide in place, and opens any other in quick edit", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const onEditInPlace = vi.fn();

        clickEdit({ noteId: "text", type: "text", content: { __html: "" } }, onEditInPlace);
        clickEdit({ noteId: "drawing", type: "canvas", content: { __html: "" } }, onEditInPlace);
        expect(onEditInPlace.mock.calls).toEqual([ [ "text" ], [ "drawing" ] ]);
        expect(triggerCommand).not.toHaveBeenCalled();

        clickEdit({ noteId: "snippet", type: "code", content: { __html: "" } }, onEditInPlace);
        expect(triggerCommand).toHaveBeenLastCalledWith("openInPopup", { noteIdOrPath: "snippet" });
        // Where slides cannot be edited in place, as in a read-only database, every slide opens in quick edit.
        clickEdit({ noteId: "text", type: "text", content: { __html: "" } }, undefined);
        expect(triggerCommand).toHaveBeenLastCalledWith("openInPopup", { noteIdOrPath: "text" });
        expect(onEditInPlace).toHaveBeenCalledTimes(2);

        triggerCommand.mockRestore();
    });
});

describe("canPickSlideBackground", () => {
    it("allows a background only where the slide's own content leaves it visible", () => {
        const slide = (props: Partial<PresentationSlideBaseModel>): PresentationSlideBaseModel => ({
            noteId: "slide", type: "text", content: { __html: "" }, ...props
        });

        expect(canPickSlideBackground(slide({}))).toBe(true);
        expect(canPickSlideBackground(slide({ type: "canvas" }))).toBe(true);
        expect(canPickSlideBackground(undefined)).toBe(false);
        expect(canPickSlideBackground(slide({ type: "webView", webViewSrc: "https://example.com/" }))).toBe(false);
        expect(canPickSlideBackground(slide({ type: "book", isCollection: true }))).toBe(false);
        expect(canPickSlideBackground(slide({ isReadOnly: true }))).toBe(false);
    });
});

function renderPicker(note: ReturnType<typeof buildNote>) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(<SlideBackgroundPicker note={note} />);
    });
    if (!container) throw new Error("The picker did not render.");
    return container;
}

function getPresetCells(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(".color-cell") ].filter(cell =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}
