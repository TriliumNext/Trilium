import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../../test/render";

const mocks = vi.hoisted(() => ({ triggerCommand: vi.fn() }));

vi.mock("../../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../../components/app_context", () => ({
    default: { triggerCommand: mocks.triggerCommand }
}));

import RelatedSettings from "./RelatedSettings";

const links = (container: HTMLElement) => [ ...container.querySelectorAll<HTMLAnchorElement>("a.tn-card-section-link") ];

describe("RelatedSettings", () => {
    it("stands down entirely when nothing is left to point at", () => {
        const container = renderInto(
            <RelatedSettings items={[ { title: "Backup", targetPage: "_optionsBackup", enabled: false } ]} />
        );

        expect(container.innerHTML).toBe("");
    });

    it("leaves out the entries that do not apply here, and keeps the rest", () => {
        const container = renderInto(
            <RelatedSettings items={[
                { title: "Backup", targetPage: "_optionsBackup" },
                { title: "Spellcheck", targetPage: "_optionsSpellcheck", enabled: false }
            ]} />
        );

        expect(links(container)).toHaveLength(1);
        expect(links(container)[0].getAttribute("href")).toBe("#root/_hidden/_options/_optionsBackup");
    });

    it("takes its own heading when the entries are something other than related settings", () => {
        const withDefault = renderInto(<RelatedSettings items={[ { title: "Backup", targetPage: "_optionsBackup" } ]} />);
        expect(withDefault.querySelector(".tn-card-heading")?.textContent).toBe("settings.related_settings");

        const named = renderInto(
            <RelatedSettings title="settings.related_actions" items={[ { title: "Space usage", targetPage: "_optionsContentManager" } ]} />
        );
        expect(named.querySelector(".tn-card-heading")?.textContent).toBe("settings.related_actions");
    });

    it("points a hidden-subtree entry at the note itself, and opens it rather than following the link", () => {
        const container = renderInto(<RelatedSettings items={[ { title: "Task states", targetNoteId: "_taskStates" } ]} />);
        const [ link ] = links(container);

        expect(link.getAttribute("href")).toBe("#root/_hidden/_taskStates");
        // It navigates for itself, so the dialog's own link handling has to stand aside.
        expect(link.hasAttribute("data-no-contained-navigation")).toBe(true);

        link.click();
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInTreePopup", {
            noteIdOrPath: "_taskStates",
            hoistedNoteId: "_taskStates"
        });
    });

    it("lets an entry with something of its own to do handle the press, link and all", () => {
        const onClick = vi.fn();
        const container = renderInto(
            <RelatedSettings items={[ { title: "Space usage", targetPage: "_optionsContentManager", onClick } ]} />
        );
        const [ link ] = links(container);

        expect(link.hasAttribute("data-no-contained-navigation")).toBe(true);
        link.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("leaves a plain page entry to be followed as the link it is", () => {
        const container = renderInto(<RelatedSettings items={[ { title: "Backup", targetPage: "_optionsBackup" } ]} />);
        expect(links(container)[0].hasAttribute("data-no-contained-navigation")).toBe(false);
    });
});
