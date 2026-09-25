import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    select: vi.fn(),
    titleContextMenu: vi.fn()
}));

vi.mock("../../../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: { getActiveContext: () => ({ hoistedNoteId: "hoistedNote" }) }
    }
}));

// Uninitialized, the real `t` answers undefined for every key — which would silently drop anything
// the component only renders when its wording resolves, the contextual-help icon included.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

// The real i18n is not initialized under test, so `Trans` would render the bare key and drop the
// interpolated value; the stub renders exactly what the component wires in.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: { i18nKey: string, components: { Size: preact.VNode } }) => (
        <span data-i18n-key={i18nKey}>{components.Size}</span>
    )
}));

import NoteUsageDonut, { segmentTooltip } from "./note_usage_donut";
import type { SpaceUsageSelection } from "./selection";

const USAGE: SpaceUsageNoteResponse = {
    noteId: "n1",
    ownSize: 10000,
    attachmentsSize: 5010,
    revisionsSize: 3000,
    subtreeRevisionsContentSize: 2400,
    noteContentSize: 150,
    subtreeContentSize: 700,
    attachments: [
        { attachmentId: "a1", title: "Attachment one", role: "file", size: 5000 },
        // Below 2% of the ring: consolidates into the "others" segment.
        { attachmentId: "tiny", title: "Tiny attachment", role: "file", size: 10 }
    ],
    // One child, so the subtree figures are tellable apart from the note's own.
    children: [ { noteId: "c1", subtreeSize: 4000, subtreeNoteCount: 2 } ]
};

let container: HTMLDivElement | undefined;

function renderDonut() {
    container = document.body.appendChild(document.createElement("div"));
    render(
        <NoteUsageDonut
            usage={USAGE}
            title="My note"
            notePath={[ "root", "n1" ]}
            centerActions={<button className="extra-action" />}
        />,
        container
    );
    return container;
}

/** How Browse renders it on a phone: a tap names the segment rather than opening what it stands for. */
function renderSelectableDonut(selectedSegmentId?: string) {
    container = document.body.appendChild(document.createElement("div"));
    render(
        <NoteUsageDonut
            usage={USAGE}
            title="My note"
            notePath={[ "root", "n1" ]}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={mocks.select}
            onTitleContextMenu={mocks.titleContextMenu}
        />,
        container
    );
    return container;
}

function lastSelection(): SpaceUsageSelection {
    return mocks.select.mock.calls[mocks.select.mock.calls.length - 1]?.[0] as SpaceUsageSelection;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.triggerCommand.mockClear();
    mocks.select.mockClear();
    mocks.titleContextMenu.mockClear();
});

describe("NoteUsageDonut", () => {
    it("renders the composition ring with the semantic segment classes, history excluded", () => {
        const probe = renderDonut();

        expect(probe.querySelector("circle.space-usage-segment-body")).not.toBeNull();
        expect(probe.querySelector("circle.space-usage-segment-attachment")).not.toBeNull();
        // The sub-2% attachment consolidated into the counted bucket.
        expect(probe.querySelector("circle.space-usage-segment-others")).not.toBeNull();
        // Despite the note's own revisions being on the payload: history belongs to the whole
        // subtree, so the children ring carries it instead.
        expect(probe.querySelector("circle.space-usage-segment-revisions")).toBeNull();
    });

    it("gives every centre line a contextual-help affordance and no tooltip of its own", () => {
        const probe = renderDonut();
        const lines = [ ...probe.querySelectorAll(".note-usage-donut-size") ];

        // Note, Revisions, Subtree — each says what it covers through its own icon.
        expect(lines).toHaveLength(3);
        for (const line of lines) {
            const icon = line.querySelector(".contextual-help-icon");
            expect(icon?.classList.contains("bx-info-circle")).toBe(true);
            // The app's tooltip, never the browser's: a native title would style and place itself
            // apart from every other hint in the hole.
            expect(icon?.getAttribute("title")).toBeNull();
            // The hint hangs off the icon alone; hovering the value itself explains nothing.
            expect(line.getAttribute("title")).toBeNull();
        }
    });

    it("defines the hatch the revisions segment is stroked with", () => {
        const probe = renderDonut();
        const pattern = probe.querySelector("svg > defs > pattern#space-usage-revisions-hatch");

        expect(pattern).not.toBeNull();
        expect(pattern?.querySelector(".space-usage-hatch-base")).not.toBeNull();
        expect(pattern?.querySelector(".space-usage-hatch-stripe")).not.toBeNull();
        // An HTML-namespaced pattern parses but paints nothing, so the stroke would silently
        // fall back to no color at all.
        expect(pattern?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    });

    it("quick-edits the note from the center title rather than navigating away", () => {
        const probe = renderDonut();
        const title = probe.querySelector<HTMLAnchorElement>(".note-usage-donut-title");

        expect(title?.textContent).toBe("My note");
        // The app's own quick-edit link form, so the markup says what the click does.
        expect(title?.getAttribute("href")).toBe("#root/n1?popup");

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        title?.dispatchEvent(click);

        // Handled here rather than let through: the hash would otherwise swap the settings page
        // itself, and the popup must stack over the dialog instead of replacing it.
        expect(click.defaultPrevented).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/n1" });
    });

    it("opens what each composition segment stands for in the quick-edit popup", () => {
        const probe = renderDonut();
        const click = (selector: string) => probe.querySelector(selector)
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        click("circle.space-usage-segment-attachment");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: { viewMode: "attachments", attachmentId: "a1" }
        });

        // The body stands for the note itself, so it opens what the center title does.
        click("circle.space-usage-segment-body");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", { noteIdOrPath: "root/n1" });

        // The bucket stands for several attachments at once, so there is nothing to open.
        mocks.triggerCommand.mockClear();
        click("circle.space-usage-segment-others");
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("names a tapped composition segment for the strip, opening nothing itself", () => {
        const probe = renderSelectableDonut();
        const tap = (selector: string) => probe.querySelector(selector)
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        tap("circle.space-usage-segment-body");
        expect(lastSelection()).toMatchObject({ markId: "body", notePath: [ "root", "n1" ], size: 10000 });
        // The body stands for the note, so the strip raises what the centre title raises.
        lastSelection().onActivate?.(new MouseEvent("click"));
        expect(mocks.titleContextMenu).toHaveBeenCalled();

        tap("circle.space-usage-segment-attachment");
        expect(lastSelection()).toMatchObject({ markId: "attachment/a1", label: "Attachment one", size: 5000 });
        lastSelection().onActivate?.(new MouseEvent("click"));
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: { viewMode: "attachments", attachmentId: "a1" }
        });

        // A ring tap opens nothing on its own, whichever segment it lands on.
        expect(lastSelection().onOpen).toBeUndefined();

        // The bucket stands for several attachments at once, so it names nothing.
        mocks.select.mockClear();
        tap("circle.space-usage-segment-others");
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it("draws the chosen segment as chosen", () => {
        const probe = renderSelectableDonut("body");

        expect(probe.querySelector("circle.space-usage-segment-body")?.classList
            .contains("donut-segment-selected")).toBe(true);
        expect(probe.querySelectorAll(".donut-segment-selected")).toHaveLength(1);
    });

    it("totals each ring in the hole, with the actions above the title", () => {
        const probe = renderDonut();
        const center = probe.querySelector<HTMLElement>(".donut-chart-center");
        const values = [ ...probe.querySelectorAll(".note-usage-donut-size-value") ].map((el) => el.textContent);

        expect(values).toEqual([
            // Body + attachments, what the composition ring draws — not the deduplicated 150.
            formatSize(15010),
            // What erasing the subtree's history would reclaim, what the gray segment draws — not
            // the per-entity 3000 sitting beside it on the payload.
            formatSize(2400),
            // Both rings together, history excluded — not the deduplicated 700.
            formatSize(19010)
        ]);
        expect(center?.firstElementChild?.classList.contains("extra-action")).toBe(true);
    });
});

describe("segmentTooltip", () => {
    it("routes each kind to its own wording", () => {
        expect(segmentTooltip("plain", "Body", 10))
            .toBe(t("space_usage.segment_tooltip", { title: "Body", size: formatSize(10) }));
        expect(segmentTooltip("attachment", "img.png", 20))
            .toBe(t("space_usage.attachment_tooltip", { title: "img.png", size: formatSize(20) }));
        expect(segmentTooltip("child", "Projects", 30))
            .toBe(t("space_usage.child_tooltip", { title: "Projects", size: formatSize(30) }));
        expect(segmentTooltip("revisions", "Revisions (including subtree revisions)", 40))
            .toBe(t("space_usage.revisions_tooltip", {
                title: "Revisions (including subtree revisions)",
                size: formatSize(40)
            }));
    });
});
