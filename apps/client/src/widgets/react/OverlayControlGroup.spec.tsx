import { type ComponentChildren, render, type RefObject } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// The bootstrap tooltip needs real layout; capture what it would have been given instead.
const { staticTooltipSpy } = vi.hoisted(() => ({ staticTooltipSpy: vi.fn() }));
vi.mock("./hooks", () => ({ useStaticTooltip: staticTooltipSpy }));
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

import OverlayControlGroup, { OverlayControlButton, OverlayFullscreenButton } from "./OverlayControlGroup";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    staticTooltipSpy.mockClear();
});

function mount(children: ComponentChildren) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(children, container));
    return container;
}

/** The tooltip config the hook was handed for the button bearing the given accessible name. */
function tooltipFor(label: string) {
    const call = staticTooltipSpy.mock.calls.find(
        (args) => (args[0] as RefObject<HTMLElement>).current?.getAttribute("aria-label") === label
    );
    return call?.[1] as { title: string; placement: string } | undefined;
}

describe("OverlayControlGroup", () => {
    it("draws a button wearing a mark at an icon's width, and one wearing words at a word's", () => {
        mount(
            <OverlayControlGroup className="my-position">
                <OverlayControlButton title="Zoom out" icon="bx-minus-circle" />
                <OverlayControlButton title="Reset zoom" text="100%" className="my-readout" />
            </OverlayControlGroup>
        );

        expect(container.querySelector(".tn-overlay-control-group.my-position")).not.toBeNull();
        const [ icon, text ] = container.querySelectorAll("button");
        // A button is driven by its onClick and must never submit a form it happens to stand in.
        expect(icon.getAttribute("type")).toBe("button");
        expect(icon.className.split(" ")).toEqual(expect.arrayContaining([ "tn-overlay-icon-button", "bx", "bx-minus-circle" ]));
        expect(text.className.split(" ")).toEqual(expect.arrayContaining([ "tn-overlay-text-button", "my-readout" ]));
        expect(text.className).not.toContain("tn-overlay-icon-button");
        expect(text.textContent).toBe("100%");
    });

    it("names a button by the words it wears, and one wearing only a mark by its title", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Zoom out" icon="bx-minus-circle" />
                <OverlayControlButton title="Create a new child note and add it to the map" text="Add marker" />
            </OverlayControlGroup>
        );

        const [ mark, words ] = container.querySelectorAll("button");
        // Nothing to read on it, so what it is called has to be said outright.
        expect(mark.getAttribute("aria-label")).toBe("Zoom out");
        // A title saying more at length would otherwise speak over the words on the face of it.
        expect(words.hasAttribute("aria-label")).toBe(false);
        expect(staticTooltipSpy.mock.calls.at(-1)?.[1]?.title).toBe("Create a new child note and add it to the map");
    });

    it("stands a mark beside the words where it is given both", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Create a new child note" icon="bx-pin" text="Add marker" />
            </OverlayControlGroup>
        );

        const button = container.querySelector("button");
        // The button keeps a word's width; the mark is a child, so the boxicons font it sets does
        // not fall on the words beside it.
        expect(button?.className).toContain("tn-overlay-text-button");
        expect(button?.className).not.toContain("bx-pin");
        const mark = button?.querySelector(".bx.bx-pin");
        expect(mark?.getAttribute("aria-hidden")).toBe("true");
        expect(button?.textContent).toBe("Add marker");
    });

    it("stays a worded button where the words it was handed came back empty", () => {
        // A translation resolved before the catalogue is loaded, which must not quietly narrow the
        // button to a mark's width and take its name with it.
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Create a new child note" icon="bx-pin" text={undefined} />
            </OverlayControlGroup>
        );

        const button = container.querySelector("button");
        expect(button?.className).toContain("tn-overlay-text-button");
        expect(button?.querySelector(".bx.bx-pin")).not.toBeNull();
    });

    it("lets a caller name a button whose face is neither words nor a mark", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton
                    title="Show keyboard shortcuts"
                    aria-label="Show keyboard shortcuts"
                    text={<kbd>?</kbd>}
                />
            </OverlayControlGroup>
        );

        const button = container.querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe("Show keyboard shortcuts");
        expect(button?.querySelector("kbd")?.textContent).toBe("?");
    });

    it("says nothing on hover where there is no title to say", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton text="3/12" className="my-readout" disabled />
            </OverlayControlGroup>
        );

        const readout = container.querySelector("button");
        expect(readout?.hasAttribute("aria-label")).toBe(false);
        expect(readout?.textContent).toBe("3/12");
        expect(staticTooltipSpy.mock.calls.at(-1)?.[1]?.title).toBeUndefined();
    });

    it("keeps a press from reaching the canvas underneath only where it stands over one", () => {
        const onMouseDown = vi.fn();
        const group = (overCanvas: boolean) => (
            <OverlayControlGroup overCanvas={overCanvas}>
                <OverlayControlButton title="Zoom in" icon="bx-plus-circle" />
            </OverlayControlGroup>
        );
        mount(group(true));
        container.addEventListener("mousedown", onMouseDown);

        container.querySelector("button")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(onMouseDown).not.toHaveBeenCalled();

        // A group over something that is not dragged lets the press through, as any button would.
        act(() => render(group(false), container));
        container.querySelector("button")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(onMouseDown).toHaveBeenCalledTimes(1);
    });

    it("marks a button held down or refused when asked to", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Placing" icon="bx-pin" active />
                <OverlayControlButton title="Refused" icon="bx-trip" disabled />
            </OverlayControlGroup>
        );

        const [ active, refused ] = container.querySelectorAll("button");
        expect(active.classList.contains("active")).toBe(true);
        expect(refused.disabled).toBe(true);
        expect(refused.classList.contains("active")).toBe(false);
    });

    it("gives each button a tooltip saying what its label does, opening the way the group says", () => {
        mount(
            <OverlayControlGroup titlePosition="bottom">
                <OverlayControlButton title="Zoom out" icon="bx-minus-circle" />
                <OverlayControlButton title="Elsewhere" icon="bx-pin" titlePosition="left" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Zoom out")).toEqual({ title: "Zoom out", placement: "bottom" });
        // A button placed unlike its neighbours overrides what the group hands down.
        expect(tooltipFor("Elsewhere")).toEqual({ title: "Elsewhere", placement: "left" });
    });

    it("opens tooltips away from the bottom edge unless told otherwise", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Zoom in" icon="bx-plus-circle" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Zoom in")?.placement).toBe("top");
    });

    it("says where it stands, for its own stylesheet to pin it there", () => {
        mount(
            <OverlayControlGroup className="my-group" placement="bottom-center">
                <OverlayControlButton title="Add note" icon="bx-folder-plus" />
            </OverlayControlGroup>
        );

        expect(container.querySelector(".my-group")?.getAttribute("data-placement")).toBe("bottom-center");
    });

    it("stays where it is put where it names no place, rather than being pinned to a corner it never asked for", () => {
        mount(
            <OverlayControlGroup className="my-group">
                <OverlayControlButton title="Add note" icon="bx-folder-plus" />
            </OverlayControlGroup>
        );

        expect(container.querySelector(".my-group")?.hasAttribute("data-placement")).toBe(false);
    });

    it("opens the tooltips of a group at the head downwards, away from the edge it stands at", () => {
        mount(
            <OverlayControlGroup placement="top-end">
                <OverlayControlButton title="Show keyboard shortcuts" icon="bx-help-circle" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Show keyboard shortcuts")?.placement).toBe("bottom");
    });

    it("lets a caller open the tooltips against the placement where it has reason to", () => {
        mount(
            <OverlayControlGroup placement="top-end" titlePosition="right">
                <OverlayControlButton title="Show keyboard shortcuts" icon="bx-help-circle" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Show keyboard shortcuts")?.placement).toBe("right");
    });

    it("keeps the same tooltip config across renders that don't change it, so it isn't rebuilt", () => {
        const group = (label: string) => (
            <OverlayControlGroup>
                <OverlayControlButton title="Reset zoom" text={label} />
            </OverlayControlGroup>
        );
        mount(group("100%"));
        const first = staticTooltipSpy.mock.calls.at(-1)?.[1];

        // Only the readout changes — what the tooltip says and where it opens are untouched.
        act(() => render(group("250%"), container));

        expect(container.querySelector("button")?.textContent).toBe("250%");
        expect(staticTooltipSpy.mock.calls.at(-1)?.[1]).toBe(first);
    });
});

describe("OverlayFullscreenButton", () => {
    it("offers the screen, and once in it offers the way back — in its mark and in its name alike", () => {
        mount(<OverlayFullscreenButton isFullscreen={false} onToggle={vi.fn()} />);
        const offered = container.querySelector("button");
        expect(offered?.className).toContain("bx-fullscreen");
        expect(offered?.className).not.toContain("bx-exit-fullscreen");
        expect(offered?.getAttribute("aria-label")).toBe("common.fullscreen");

        act(() => render(<OverlayFullscreenButton isFullscreen onToggle={vi.fn()} />, container));
        const held = container.querySelector("button");
        expect(held?.className).toContain("bx-exit-fullscreen");
        expect(held?.getAttribute("aria-label")).toBe("common.exit_fullscreen");
    });

    it("asks the caller to make the change, which is the one thing it does not do itself", () => {
        const onToggle = vi.fn();
        mount(<OverlayFullscreenButton isFullscreen={false} onToggle={onToggle} />);

        act(() => container.querySelector("button")?.click());

        // Called with nothing: the press is the caller's cue, not something to hand on.
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith();
    });
});
