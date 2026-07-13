import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import OptionsBlock from "./OptionsBlock";
import OptionsGroup from "./OptionsGroup";
import OptionsRow, { OptionsRowLink } from "./OptionsRow";
import OptionsSection from "./OptionsSection";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
});

/** The card segments of the rendered options section, in document order. */
function segments() {
    return Array.from(container.querySelectorAll<HTMLElement>(".tn-card-section"));
}

function textbox(name: string) {
    return <input type="text" name={name} />;
}

/** A component wrapping its rows in a fragment — the prevailing shape of the options pages. */
function DateSettings({ visible }: { visible: boolean }) {
    return (
        <>
            <OptionsRow name="first-week" label="First week">{textbox("first-week")}</OptionsRow>
            <OptionsGroup visible={visible}>
                <OptionsRow name="min-days" label="Minimum days">{textbox("min-days")}</OptionsRow>
            </OptionsGroup>
            <OptionsRow name="restart" label="Restart">{textbox("restart")}</OptionsRow>
        </>
    );
}

describe("OptionsSection", () => {
    it("gives every row a segment of the card to itself", () => {
        render(
            <OptionsSection title="Search" description="How search behaves.">
                <OptionsRow name="first" label="First">{textbox("first")}</OptionsRow>
                <OptionsRow name="second" label="Second">{textbox("second")}</OptionsRow>
            </OptionsSection>,
            container
        );

        // Each row is a segment in its own right — a flex child of the card body, which is what earns
        // it the card's seam. A single box wrapping both rows would divide them with a hairline.
        const found = segments();
        expect(found).toHaveLength(2);
        for (const segment of found) {
            expect(segment.classList.contains("option-row")).toBe(true);
            expect(segment.parentElement?.classList.contains("tn-card-body")).toBe(true);
        }

        // The title and the description introduce the card rather than taking a segment of it.
        expect(container.querySelector(".options-section-header h4")?.textContent).toBe("Search");
        expect(container.querySelector(".tn-card .options-section-description")).toBeNull();
        expect(container.querySelector(".options-section-description")?.textContent).toBe("How search behaves.");
    });

    it("nests the rows of a group, even one buried inside a wrapper component", () => {
        // `toChildArray` cannot see through a component, so anything that segmented rows by
        // inspecting OptionsSection's children would miss every row here — and wrapper components
        // like this are how the options pages are actually written.
        render(
            <OptionsSection title="Localization">
                <DateSettings visible />
            </OptionsSection>,
            container
        );

        const [firstWeek, minDays, restart] = segments();
        expect(segments()).toHaveLength(3);

        // The governed row indents and tints; the rows around it stay at the top level.
        expect(minDays.classList.contains("tn-card-section-nested")).toBe(true);
        expect(minDays.style.getPropertyValue("--tn-card-section-nesting-level")).toBe("1");
        expect(firstWeek.classList.contains("tn-card-section-nested")).toBe(false);
        expect(restart.classList.contains("tn-card-section-nested")).toBe(false);

        // Nesting is a matter of level, not of containment: every row remains a sibling segment, so
        // each keeps its own seam rather than being boxed together.
        expect(minDays.parentElement?.classList.contains("tn-card-body")).toBe(true);
    });

    it("omits a hidden group without disturbing the rows around it", () => {
        render(
            <OptionsSection title="Localization">
                <DateSettings visible={false} />
            </OptionsSection>,
            container
        );

        expect(segments()).toHaveLength(2);
        expect(container.querySelector(".tn-card-section-nested")).toBeNull();
    });

    it("renders a link row as an anchor segment, so contained navigation still finds it", () => {
        render(
            <OptionsSection title="Related">
                <OptionsRowLink label="Appearance" href="#root/_hidden/_options/_optionsAppearance" />
            </OptionsSection>,
            container
        );

        const [link] = segments();
        expect(link.tagName).toBe("A");
        expect(link.classList.contains("option-row-link")).toBe(true);
        expect(link.getAttribute("href")).toBe("#root/_hidden/_options/_optionsAppearance");
    });

    it("gives non-row content a segment via OptionsBlock, and leaves rows divided outside a card", () => {
        render(
            <OptionsSection title="Highlights">
                <OptionsBlock><p id="prose">Some explanation.</p></OptionsBlock>
            </OptionsSection>,
            container
        );

        const [block] = segments();
        expect(block.classList.contains("options-block")).toBe(true);
        expect(block.querySelector("#prose")).not.toBeNull();

        // Outside an options card there is no card to segment, so the block just passes its content
        // through and the rows keep the divided layout the dialogs were designed with.
        render(
            <OptionsSection title="Print" noCard>
                <OptionsBlock><p id="prose">Some explanation.</p></OptionsBlock>
                <OptionsRow name="row" label="Row">{textbox("row")}</OptionsRow>
            </OptionsSection>,
            container
        );

        expect(segments()).toHaveLength(0);
        expect(container.querySelector(".tn-card")).toBeNull();
        expect(container.querySelector("#prose")).not.toBeNull();
        expect(container.querySelector(".option-row")?.tagName).toBe("DIV");
    });
});
