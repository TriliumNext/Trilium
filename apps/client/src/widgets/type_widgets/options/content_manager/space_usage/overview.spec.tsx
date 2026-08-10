import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    openContextMenu: vi.fn(),
    openDeletedNotesMenu: vi.fn(),
    openRevisionsMenu: vi.fn(),
    showDetails: vi.fn(),
    contentChanged: vi.fn()
}));

vi.mock("../../../../../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: { getActiveContext: () => null }
    }
}));

// The menus themselves are covered by their own spec; here only the wiring matters.
vi.mock("./context_menu", async (importOriginal) => ({
    ...await importOriginal<typeof import("./context_menu")>(),
    openSpaceUsageContextMenu: (...args: unknown[]) => mocks.openContextMenu(...args),
    openDeletedNotesContextMenu: (...args: unknown[]) => mocks.openDeletedNotesMenu(...args),
    openRevisionsContextMenu: (...args: unknown[]) => mocks.openRevisionsMenu(...args)
}));

// The treemap container never gets a real layout under happy-dom; the rest of the hooks are the
// real ones.
vi.mock("../../../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../../react/hooks")>(),
    useElementSize: () => ({ width: 400, height: 300 })
}));

vi.mock("../../../../../services/froca", () => ({
    default: {
        getNotes: async (noteIds: string[]) =>
            noteIds.map((noteId) => ({ noteId, getIcon: () => `tn-icon bx bx-${noteId}` }))
    }
}));

import Overview from "./overview";

const OVERVIEW: SpaceUsageOverviewResponse = {
    content: { size: 400, noteCount: 3, attachmentsSize: 0, revisionsSize: 60 },
    notes: [ { noteId: "n1", notePath: [ "n1" ], ownSize: 200, attachmentsSize: 0, revisionsSize: 0 } ],
    otherNotes: { size: 50, revisionsSize: 0, noteCount: 2 },
    hiddenNotes: { size: 80, revisionsSize: 0, noteCount: 10 },
    deletedNotes: { size: 70, noteCount: 1, attachmentCount: 0 },
    unusedAttachments: { size: 0, attachmentCount: 0 },
    total: { size: 250, revisionsSize: 0, noteCount: 3 }
};

let container: HTMLDivElement | undefined;

function renderOverview() {
    container = document.body.appendChild(document.createElement("div"));
    render(
        <Overview
            overview={OVERVIEW}
            onShowDetails={mocks.showDetails}
            onContentChanged={mocks.contentChanged}
        />,
        container
    );
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.triggerCommand.mockClear();
    mocks.openContextMenu.mockClear();
    mocks.openDeletedNotesMenu.mockClear();
    mocks.openRevisionsMenu.mockClear();
    mocks.showDetails.mockClear();
});

describe("Overview", () => {
    it("renders a cell per note plus the four bucket cells", () => {
        const probe = renderOverview();

        expect(probe.querySelector('[data-href="#root/n1"]')).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-other")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-hidden")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-revisions")).not.toBeNull();
        expect(probe.querySelector(".treemap-cell-deleted")).not.toBeNull();
    });

    it("draws a cell for a note whose weight is partly attachments, beside one with none", () => {
        container = document.body.appendChild(document.createElement("div"));
        render(
            <Overview
                overview={{
                    ...OVERVIEW,
                    notes: [
                        ...OVERVIEW.notes,
                        { noteId: "n2", notePath: [ "n2" ], ownSize: 100, attachmentsSize: 120, revisionsSize: 0 }
                    ]
                }}
                onShowDetails={mocks.showDetails}
                onContentChanged={mocks.contentChanged}
            />,
            container
        );

        // Both are drawn the same way; only the size line beneath them differs, and it is the model's
        // spec that pins its wording.
        expect(container.querySelector('[data-href="#root/n1"]')).not.toBeNull();
        expect(container.querySelector('[data-href="#root/n2"]')).not.toBeNull();
    });

    it("dresses note cells in their froca icons and the buckets in what they stand for", async () => {
        const probe = renderOverview();
        const iconIn = (selector: string) =>
            probe.querySelector(`${selector} > .treemap-cell-icon`)?.className;

        // The map draws first and picks the note icons up on the next render.
        await vi.waitFor(() => expect(iconIn('[data-href="#root/n1"]')).toContain("bx-n1"));

        expect(iconIn(".treemap-cell-other")).toContain("bx-dots-horizontal-rounded");
        expect(iconIn(".treemap-cell-hidden")).toContain("bx-hide");
        expect(iconIn(".treemap-cell-revisions")).toContain("bx-history");
        expect(iconIn(".treemap-cell-deleted")).toContain("bx-trash-alt");
    });

    it("quick-edits a clicked note and offers the menu on right-click, while the bucket cells stay inert", () => {
        const probe = renderOverview();
        const cell = probe.querySelector('[data-href="#root/n1"]');

        cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/n1" });

        cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(mocks.openContextMenu).toHaveBeenCalledWith(
            expect.anything(), [ "root", "n1" ], mocks.showDetails, mocks.contentChanged);

        mocks.triggerCommand.mockClear();
        mocks.openContextMenu.mockClear();
        const bucket = probe.querySelector(".treemap-cell-other");
        bucket?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        bucket?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
        expect(mocks.openContextMenu).not.toHaveBeenCalled();
    });

    it("answers the deleted bucket with its own menu, never the note one", () => {
        const probe = renderOverview();
        const deleted = probe.querySelector(".treemap-cell-deleted");

        deleted?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        // The bucket names no note, so the note menu has nothing to act on; erasing does.
        expect(mocks.openContextMenu).not.toHaveBeenCalled();
        expect(mocks.openDeletedNotesMenu)
            .toHaveBeenCalledWith(expect.anything(), mocks.contentChanged);

        // Clicking it stays inert, like the other buckets.
        deleted?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("answers the revisions bucket with its own menu, never the note one", () => {
        const probe = renderOverview();

        probe.querySelector(".treemap-cell-revisions")
            ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        expect(mocks.openContextMenu).not.toHaveBeenCalled();
        expect(mocks.openRevisionsMenu)
            .toHaveBeenCalledWith(expect.anything(), mocks.contentChanged);
    });
});
