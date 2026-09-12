import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import { useActiveHeading } from "./TableOfContents";

const HEADINGS = [
    { id: "first", level: 1, text: "First" },
    { id: "second", level: 2, text: "Second" }
];

describe("useActiveHeading", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("re-subscribes when getHeadingElement changes, even though the container element does not", () => {
        // The editor is swapped (watchdog recovery) while .scrolling-container, an ancestor of the
        // editor root, stays put — so the listener has to follow getHeadingElement, not the container.
        const container = scrollingContainer();
        const probe = mount(container, headingLookup({ first: 0, second: 500 }));
        scroll(container);
        expect(activeOf(probe)).toBe("first");

        update(probe, container, headingLookup({ first: 0, second: 0 }));
        scroll(container);
        expect(activeOf(probe)).toBe("second");
    });

    it("takes the last heading above the line, and clears once the container goes away", () => {
        const container = scrollingContainer();
        const probe = mount(container, headingLookup({ first: 0, second: 0 }));
        scroll(container);
        expect(activeOf(probe)).toBe("second");

        update(probe, null, headingLookup({ first: 0, second: 0 }));
        expect(activeOf(probe)).toBe("");
    });
});

function ActiveHeadingProbe({ container, getHeadingElement }: {
    container: HTMLElement | null;
    getHeadingElement(heading: typeof HEADINGS[number]): HTMLElement | null;
}) {
    const activeHeadingId = useActiveHeading({
        headings: HEADINGS,
        scrollingContainer: container,
        getHeadingElement
    });

    return <div data-active={activeHeadingId ?? ""} />;
}

type HeadingLookup = (heading: typeof HEADINGS[number]) => HTMLElement | null;

function mount(container: HTMLElement | null, getHeadingElement: HeadingLookup) {
    let probe: HTMLElement | undefined;
    act(() => {
        probe = renderInto(<ActiveHeadingProbe container={container} getHeadingElement={getHeadingElement} />);
    });
    if (!probe) throw new Error("probe did not render");
    return probe;
}

function update(probe: HTMLElement, container: HTMLElement | null, getHeadingElement: HeadingLookup) {
    act(() => {
        render(<ActiveHeadingProbe container={container} getHeadingElement={getHeadingElement} />, probe);
    });
}

function scroll(container: HTMLElement) {
    act(() => {
        container.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(100);
    });
}

function activeOf(probe: HTMLElement) {
    return probe.firstElementChild?.getAttribute("data-active");
}

/** happy-dom reports zeroes for every rect, so each element is given the top the test needs. */
function elementAt(top: number) {
    const el = document.createElement("h1");
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
    return el;
}

function scrollingContainer() {
    const container = elementAt(0);
    document.body.appendChild(container);
    return container;
}

/** Stands in for one editor instance: which DOM element each heading currently maps to. */
function headingLookup(tops: Record<string, number>): HeadingLookup {
    const elements = new Map(Object.entries(tops).map(([id, top]) => [id, elementAt(top)]));
    return (heading) => elements.get(heading.id) ?? null;
}
