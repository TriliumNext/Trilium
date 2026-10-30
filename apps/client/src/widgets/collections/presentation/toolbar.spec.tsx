import { render as preactRender } from "preact";
import { act } from "preact/test-utils";
import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// i18next is never initialized under test, so `t()` looks keys up in the English catalog itself.
vi.mock("../../../services/i18n", async () => {
    const { default: english } = await import("../../../translations/en/translation.json");
    return {
        t: (key: string, args: Record<string, unknown> = {}) => {
            const text = key.split(".").reduce<unknown>(
                (node, part) => (node as Record<string, unknown> | undefined)?.[part], english
            );
            return String(text).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(args[name]));
        }
    };
});

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
import PresentationControls, { canPickSlideBackground, SlideBackgroundPicker } from "./toolbar";

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
        const { container } = renderControls({ slideToEdit: { slide, onEditInPlace } });
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

    it("finishes the edit in progress, held down while it lasts", () => {
        const onFinishEditing = vi.fn();
        const { container } = renderControls({
            isEditing: true,
            onFinishEditing,
            slideToEdit: { slide: undefined, onEditInPlace: vi.fn() }
        });

        expect(container.querySelector("button.bx-edit")).toBeNull();
        const finish = container.querySelector<HTMLButtonElement>("button.bx-check");
        expect(finish?.classList.contains("active")).toBe(true);
        expect(finish?.getAttribute("aria-label")).toBe("Finish editing");
        act(() => finish?.click());
        expect(onFinishEditing).toHaveBeenCalledOnce();
    });
});

describe("PresentationControls", () => {
    afterEach(() => {
        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        vi.useRealTimers();
    });

    it("counts the slides and steps through them, stopping at either end", () => {
        const { container, api, rerender } = renderControls({ activeNoteId: "first" });
        const button = (icon: string) => container.querySelector<HTMLButtonElement>(`button.${icon}`);

        expect(container.querySelector(".presentation-slide-counter")?.textContent).toBe("1 / 3");
        expect(button("bx-chevron-left")?.disabled).toBe(true);
        act(() => button("bx-chevron-right")?.click());
        expect(api.next).toHaveBeenCalledOnce();

        rerender({ activeNoteId: "last" });
        expect(container.querySelector(".presentation-slide-counter")?.textContent).toBe("3 / 3");
        expect(button("bx-chevron-right")?.disabled).toBe(true);
        act(() => button("bx-chevron-left")?.click());
        expect(api.prev).toHaveBeenCalledOnce();

        act(() => button("bx-grid-horizontal")?.click());
        expect(api.toggleOverview).toHaveBeenCalledOnce();
    });

    it("offers the kinds of new slide in a menu beside the new slide button", async () => {
        const onNewSlide = vi.fn();
        const { container } = renderControls({ onNewSlide });

        act(() => container.querySelector<HTMLButtonElement>(".presentation-new-slide")?.click());
        expect(onNewSlide).toHaveBeenLastCalledWith(expect.objectContaining({ type: "text" }));

        const toggle = container.querySelector<HTMLButtonElement>(".tn-overlay-control-dropdown button.bx-chevron-down");
        expect(toggle).not.toBeNull();
        await act(async () => toggle?.click());
        const items = await vi.waitFor(() => {
            const found = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
            expect(found.length).toBeGreaterThan(1);
            return found;
        });
        await act(async () => items[1].click());
        expect(onNewSlide).toHaveBeenLastCalledWith(expect.objectContaining({ type: "canvas" }));
    });

    it("leaves only the navigation in full-screen, and fades it out while the pointer rests", () => {
        vi.useFakeTimers();
        const { container, stage } = renderControls({
            onNewSlide: vi.fn(),
            slideToEdit: { slide: undefined, onEditInPlace: undefined }
        });
        const controls = () => container.querySelector(".presentation-controls");
        expect(container.querySelector(".presentation-edit-controls")).not.toBeNull();

        Object.defineProperty(document, "fullscreenElement", { value: stage, configurable: true });
        act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
        expect(container.querySelector(".presentation-edit-controls")).toBeNull();
        expect(container.querySelector("button.bx-exit-fullscreen")).not.toBeNull();
        expect(controls()?.classList.contains("is-idle")).toBe(false);

        act(() => { vi.advanceTimersByTime(3000); });
        expect(controls()?.classList.contains("is-idle")).toBe(true);
        act(() => { stage.dispatchEvent(new Event("pointermove")); });
        expect(controls()?.classList.contains("is-idle")).toBe(false);

        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
        act(() => { vi.advanceTimersByTime(3000); });
        expect(controls()?.classList.contains("is-idle")).toBe(false);
        expect(container.querySelector(".presentation-edit-controls")).not.toBeNull();
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

type ControlsProps = Parameters<typeof PresentationControls>[0];

function renderControls(props: Partial<ControlsProps> = {}) {
    const stage = document.createElement("div");
    document.body.appendChild(stage);
    const api = {
        prev: vi.fn(), next: vi.fn(), toggleOverview: vi.fn(), isOverview: () => false, on: vi.fn(), off: vi.fn()
    };
    const controls = (overrides: Partial<ControlsProps>) => <PresentationControls
        api={api as unknown as RevealApi}
        stage={stage}
        slideNoteIds={[ "first", "middle", "last" ]}
        activeNoteId="middle"
        isEditing={false}
        onFinishEditing={vi.fn()}
        onNewSlide={undefined}
        backgroundSlide={undefined}
        slideToEdit={undefined}
        {...overrides}
    />;
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(controls(props));
    });
    if (!container) throw new Error("The controls did not render.");
    const target = container;
    const rerender = (overrides: Partial<ControlsProps>) => act(() => {
        preactRender(controls({ ...props, ...overrides }), target);
    });
    return { container: target, stage, api, rerender };
}

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
