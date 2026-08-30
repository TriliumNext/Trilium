import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import { Card, CardFrame, CardSection, OptionCardSection } from "./Card";
import { FilterProvider } from "./filter";

describe("Card", () => {
    it("carries a heading, a sentence and controls of its own, and drops the heading line with nothing on it", () => {
        const withHeading = renderInto(
            <Card heading="Backups" description="How often a copy is taken." actions={<button>Add</button>}>
                <CardSection>body</CardSection>
            </Card>
        );

        expect(withHeading.querySelector(".tn-card-heading")?.textContent).toContain("Backups");
        expect(withHeading.querySelector(".tn-card-heading-actions button")).not.toBeNull();
        expect(withHeading.querySelector(".tn-card-description")?.textContent).toBe("How often a copy is taken.");

        const bare = renderInto(<Card><CardSection>body</CardSection></Card>);
        expect(bare.querySelector(".tn-card-heading")).toBeNull();
        expect(bare.querySelector(".tn-card-body")).not.toBeNull();
    });
});

describe("CardFrame", () => {
    it("is a lone framed block, highlighting only when asked", () => {
        const plain = renderInto(<CardFrame>held</CardFrame>).querySelector(".tn-card-frame");
        expect(plain?.className).not.toContain("tn-card-highlight-on-hover");

        const hoverable = renderInto(<CardFrame highlightOnHover>held</CardFrame>).querySelector(".tn-card-frame");
        expect(hoverable?.className).toContain("tn-card-highlight-on-hover");
    });
});

describe("CardSection", () => {
    it("is a plain section, pressable when given something to do", () => {
        const onAction = vi.fn();
        const container = renderInto(<CardSection onAction={onAction}>held</CardSection>);
        const section = container.querySelector("section");

        expect(section?.className).toContain("tn-card-highlight-on-hover");
        section?.click();
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("drops its padding on request, for a segment filled edge to edge", () => {
        const section = renderInto(<CardSection noPadding>held</CardSection>).querySelector("section");
        expect(section?.className).toContain("tn-no-padding");
    });

    it("shows what is nested beneath it only while that is asked for, marked a level deeper", () => {
        const nested = <CardSection className="child">nested</CardSection>;

        const hidden = renderInto(<CardSection subSections={[ nested ]}>parent</CardSection>);
        expect(hidden.querySelector(".child")).toBeNull();

        const shown = renderInto(<CardSection subSections={[ nested ]} subSectionsVisible>parent</CardSection>);
        const child = shown.querySelector(".child");
        expect(child?.className).toContain("tn-card-section-nested");
        // The level drives the indent and the ground tint, so it has to say which one it is.
        expect(child?.getAttribute("style")).toContain("--tn-card-section-nesting-level: 1");
    });
});

describe("OptionCardSection", () => {
    it("ties the label to its control when named, and leaves it loose when not", () => {
        const bound = renderInto(
            <OptionCardSection name="word-wrap" label="Word wrapping"><input type="checkbox" /></OptionCardSection>
        );
        const input = bound.querySelector("input");
        expect(bound.querySelector("label")?.getAttribute("for")).toBe(input?.id);
        expect(input?.id).toBeTruthy();

        // Nothing to point at: a set of buttons, not one control.
        const loose = renderInto(
            <OptionCardSection label="Shortcut"><button>a</button><button>b</button></OptionCardSection>
        );
        expect(loose.querySelector("label")?.getAttribute("for")).toBeNull();
    });

    it("keeps the sentence with the label, so the two read as one name", () => {
        const container = renderInto(<OptionCardSection label="Word wrapping" description="Wraps long lines." />);
        const label = container.querySelector(".tn-card-option-label");

        expect(label?.firstChild?.textContent).toBe("Word wrapping");
        expect(label?.querySelector(".tn-card-option-description")?.textContent).toBe("Wraps long lines.");
    });

    it("holds a name made of several things together, rather than stacking its parts", () => {
        const container = renderInto(
            <OptionCardSection
                label={<>Background effects <span className="platforms" /></>}
                description="Blurs the window behind."
            />
        );

        // The label lays the sentence out under the name, so a name in pieces would be laid out
        // the same way — a badge marking which platforms a setting applies to would end up on a
        // line of its own.
        const title = container.querySelector(".tn-card-option-title");
        expect(title?.textContent).toContain("Background effects");
        expect(title?.querySelector(".platforms")).not.toBeNull();
    });

    it("puts the control on the line below when stacked", () => {
        const inline = renderInto(<OptionCardSection label="Address"><input /></OptionCardSection>);
        expect(inline.querySelector(".tn-card-option")?.className).not.toContain("tn-card-option-stacked");

        const stacked = renderInto(<OptionCardSection label="Address" stacked><input /></OptionCardSection>);
        expect(stacked.querySelector(".tn-card-option")?.className).toContain("tn-card-option-stacked");
    });
});

describe("a segment that leads somewhere", () => {
    it("becomes a link carrying a chevron, rather than a section", () => {
        const container = renderInto(<OptionCardSection label="Backup" href="#root/_hidden/_options/_optionsBackup" />);
        const link = container.querySelector("a");

        expect(container.querySelector("section")).toBeNull();
        expect(link?.getAttribute("href")).toBe("#root/_hidden/_options/_optionsBackup");
        expect(link?.className).toContain("tn-card-section-link");
        // It leads somewhere, so it highlights under the pointer like any other pressable segment.
        expect(link?.className).toContain("tn-card-highlight-on-hover");
        // The note tooltip would otherwise open over a row that is only a way onwards.
        expect(link?.className).toContain("no-tooltip-preview");
        expect(link?.querySelector(".tn-card-section-chevron")).not.toBeNull();
    });

    it("hands its handler the event, which is what lets an entry navigate for itself", () => {
        const onAction = vi.fn();
        const container = renderInto(<OptionCardSection label="Task states" href="#root/_hidden/_taskStates" onAction={onAction} />);

        container.querySelector("a")?.click();
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onAction.mock.calls[0][0]).toBeInstanceOf(Event);
    });

    it("opts out of the dialog's contained navigation only when told to", () => {
        const contained = renderInto(<OptionCardSection label="Backup" href="#a" />);
        expect(contained.querySelector("a")?.hasAttribute("data-no-contained-navigation")).toBe(false);

        const own = renderInto(<OptionCardSection label="Backup" href="#a" noContainedNavigation />);
        expect(own.querySelector("a")?.hasAttribute("data-no-contained-navigation")).toBe(true);
    });
});

describe("under a filter", () => {
    const settings = (
        <>
            <OptionCardSection
                className="wrapping"
                label="Word wrapping"
                description="Wraps long lines."
            />
            <OptionCardSection className="theme" label="Theme" />
        </>
    );

    it("shows a setting only while it matches, by its label or by its sentence", () => {
        const unfiltered = renderInto(settings);
        expect(unfiltered.querySelectorAll(".tn-card-option")).toHaveLength(2);

        const byLabel = renderInto(<FilterProvider query="theme">{settings}</FilterProvider>);
        expect(byLabel.querySelector(".wrapping")).toBeNull();
        expect(byLabel.querySelector(".theme")).not.toBeNull();

        const bySentence = renderInto(
            <FilterProvider query="long lines">{settings}</FilterProvider>
        );
        expect(bySentence.querySelector(".wrapping")).not.toBeNull();
        expect(bySentence.querySelector(".theme")).toBeNull();
    });

    it("hands a card that matched by name everything it holds", () => {
        const container = renderInto(
            <FilterProvider query="appearance">
                <Card heading="Appearance" description="How the app is drawn.">
                    {settings}
                    <CardSection className="picture">an illustrated choice</CardSection>
                </Card>
            </FilterProvider>
        );

        expect(classesOf(container, ".tn-card")).toContain("tn-filter-match");
        expect(container.querySelectorAll(".tn-card-option")).toHaveLength(2);
        expect(container.querySelector(".picture")).not.toBeNull();
    });

    it("finds a card and a setting by words that are not written on either", () => {
        const card = renderInto(
            <FilterProvider query="rest api">
                <Card filterExtraKeywords="ETAPI is a REST API">
                    <OptionCardSection className="token" label="my token" />
                </Card>
            </FilterProvider>
        );

        // The card matched, so what it holds comes with it, and the words are never written out.
        expect(classesOf(card, ".tn-card")).toContain("tn-filter-match");
        expect(card.querySelector(".token")).not.toBeNull();
        expect(card.textContent).not.toContain("REST");

        const setting = renderInto(
            <FilterProvider query="passphrase">
                <OptionCardSection
                    className="secret" label="Password" filterExtraKeywords="passphrase"
                />
            </FilterProvider>
        );

        expect(setting.querySelector(".secret")).not.toBeNull();
        expect(setting.textContent).toBe("Password");
    });

    it("holds back a card that is there to be found rather than read", () => {
        const actions = <Card filterOnly heading="Related actions">{settings}</Card>;

        expect(renderInto(actions).querySelector(".tn-card")).toBeNull();
        expect(renderInto(
            <FilterProvider query="theme">{actions}</FilterProvider>
        ).querySelector(".tn-card")).not.toBeNull();
    });

    it("keeps a section that accompanies the settings instead of being one", () => {
        const card = (query: string) => renderInto(
            <FilterProvider query={query}>
                <Card heading="Appearance">
                    {settings}
                    <CardSection className="preview" filterRole="companion">a preview</CardSection>
                </Card>
            </FilterProvider>
        );

        // Stands beside the setting that matched, where a plain section would have been taken down.
        expect(classesOf(card("theme"), ".preview")).toContain("tn-filter-companion");
        // And is never a result of its own, so it cannot keep an emptied card alive.
        expect(card("nothing at all").querySelector(".tn-filter-match")).toBeNull();
    });

    it("marks a card that did not match, so CSS can take it down to the settings that did", () => {
        const container = renderInto(
            <FilterProvider query="theme">
                <Card heading="Appearance">
                    {settings}
                    <CardSection className="picture">an illustrated choice</CardSection>
                </Card>
            </FilterProvider>
        );

        expect(classesOf(container, ".tn-card")).toContain("tn-filter-scope");
        expect(container.querySelector(".wrapping")).toBeNull();
        expect(container.querySelector(".theme")).not.toBeNull();
        // Still rendered: hiding it is the CSS rule's job, which happy-dom does not apply.
        expect(container.querySelector(".picture")).not.toBeNull();
    });

    it("leaves a card unmarked while nothing is being filtered", () => {
        const container = renderInto(<Card heading="Appearance">{settings}</Card>);

        expect(classesOf(container, ".tn-card")).not.toContain("tn-filter-scope");
    });

    it("brings a setting's sub-sections along when the setting itself matched", () => {
        const container = fontsCard("custom fonts");

        expect(container.querySelector(".size")).not.toBeNull();
        // The filter sits between the section and what it nests, so the indent must survive it.
        expect(container.querySelector(".size")?.className).toContain("tn-card-section-nested");
        expect(container.querySelector(".tn-filter-companion")).toBeNull();
    });

    it("keeps a setting whose sub-section matched, so the detail is read under it", () => {
        const container = fontsCard("font size");

        expect(container.querySelector(".size")).not.toBeNull();
        // Kept for the sub-section's sake rather than its own, which is what the mark says: CSS
        // takes it down again once nothing is left beside it, and happy-dom applies no CSS.
        expect(classesOf(container, ".fonts")).toContain("tn-filter-companion");
    });

    it("leaves a setting nothing to stand on once none of its sub-sections matched", () => {
        const container = fontsCard("nothing at all");

        expect(container.querySelector(".size")).toBeNull();
        expect(classesOf(container, ".fonts")).toContain("tn-filter-companion");
    });

    /** A setting with a single detail under it, the pairing the filter has to tell apart. */
    function fontsCard(query: string) {
        const fontSize = <OptionCardSection key="size" className="size" label="Font size" />;

        return renderInto(
            <FilterProvider query={query}>
                <Card heading="Appearance">
                    <OptionCardSection
                        className="fonts"
                        label="Custom fonts"
                        subSections={[ fontSize ]}
                        subSectionsVisible
                    />
                </Card>
            </FilterProvider>
        );
    }
});

function classesOf(container: HTMLElement, selector: string) {
    return container.querySelector(selector)?.className;
}
