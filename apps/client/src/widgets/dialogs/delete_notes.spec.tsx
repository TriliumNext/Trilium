import type { AttributeRow, DeleteNotesPreview } from "@triliumnext/commons";
import { type ComponentChildren, type VNode } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Replace the bootstrap-driven Modal with a transparent shell so we can drive footer buttons and the
// onShown/onHidden lifecycle without happy-dom's inert Modal/openDialog machinery.
vi.mock("../react/Modal.js", () => ({
    default: ({ children, footer, show, onShown, onHidden, title, className }: {
        children?: ComponentChildren;
        footer?: ComponentChildren;
        show: boolean;
        onShown?: () => void;
        onHidden?: () => void;
        title?: ComponentChildren;
        className?: string;
    }) => (
        <div className={`mock-modal ${className ?? ""}`} data-shown={show ? "1" : "0"}>
            <div className="mock-modal-title">{title}</div>
            <button type="button" className="mock-shown" onClick={() => onShown?.()} />
            <button type="button" className="mock-hidden" onClick={() => onHidden?.()} />
            <div className="mock-modal-body">{children}</div>
            <div className="mock-modal-footer">{footer}</div>
        </div>
    )
}));

// NoteLink loads links asynchronously via froca/link; stub it so rows render deterministically.
vi.mock("../react/NoteLink.js", () => ({
    default: ({ notePath }: { notePath: string | string[] }) => (
        <span className="mock-note-link" data-note-path={Array.isArray(notePath) ? notePath.join("/") : notePath} />
    )
}));

// react-window's List needs a measured viewport; render rows directly so the virtualized branch and
// DeletedNoteRow are exercised under happy-dom.
vi.mock("react-window", () => ({
    List: ({ rowComponent: Row, rowCount, rowProps, className, tagName }: {
        rowComponent: (props: { index: number; style: object } & Record<string, unknown>) => VNode;
        rowCount: number;
        rowProps: Record<string, unknown>;
        className?: string;
        tagName?: string;
    }) => {
        const Tag = (tagName ?? "div") as "ul";
        const rows: VNode[] = [];
        for (let index = 0; index < rowCount; index++) {
            rows.push(<Row index={index} style={{}} {...rowProps} />);
        }
        return <Tag className={className}>{rows}</Tag>;
    }
}));

import Component from "../../components/component";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import froca from "../../services/froca";
import DeleteNotesDialog from "./delete_notes";

// --- Harness -------------------------------------------------------------------------------------

let parent: Component;

function renderDialog() {
    const { container, parent: renderedParent } = renderComponent(<DeleteNotesDialog />);
    parent = renderedParent;
    return container;
}

function fireShow(opts: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)("showDeleteNotesDialog", opts);
    });
}

function setPreview(preview: DeleteNotesPreview) {
    Object.assign(server, { post: vi.fn(async () => preview) });
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    setPreview({ noteIdsToBeDeleted: [], brokenRelations: [] });
});

// --- Tests ---------------------------------------------------------------------------------------

describe("DeleteNotesDialog", () => {
    it("is hidden initially and becomes shown on the showDeleteNotesDialog event", async () => {
        const root = renderDialog();
        expect(root.querySelector(".mock-modal")?.getAttribute("data-shown")).toBe("0");

        const callback = vi.fn();
        fireShow({ branchIdsToDelete: [], callback });
        await flush();
        expect(root.querySelector(".mock-modal")?.getAttribute("data-shown")).toBe("1");
        // No branches → no preview request, and only the erase toggle (no clones option).
        expect(server.post).not.toHaveBeenCalled();
        expect(root.querySelectorAll(".switch-toggle").length).toBe(1);
    });

    it("requests a preview, lists notes to be deleted, and shows broken relations", async () => {
        const parentNote = buildNote({
            id: "p1",
            title: "Parent",
            children: [ { id: "c1", title: "C1" }, { id: "c2", title: "C2" } ]
        });
        const branchIds = parentNote.getChildBranches().map((b) => b.branchId).filter((id): id is string => !!id);

        const brokenRelations: AttributeRow[] = [
            { type: "relation", name: "template", value: "c1", noteId: "src1" },
            // Filtered out (missing value) → not rendered as a row but still counted in the heading.
            { type: "relation", name: "ignored", noteId: "src2" }
        ];
        setPreview({ noteIdsToBeDeleted: [ "c1", "c2" ], brokenRelations });

        const root = renderDialog();
        fireShow({ branchIdsToDelete: branchIds });
        await flush();

        expect(server.post).toHaveBeenCalledWith("delete-notes-preview", {
            branchIdsToDelete: branchIds,
            deleteAllClones: false
        });

        // Deleted notes list (non-virtualized path: 2 <= threshold).
        const links = root.querySelectorAll(".preview-list .mock-note-link");
        expect(links.length).toBe(2);
        expect(Array.from(links).map((el) => el.getAttribute("data-note-path"))).toEqual([ "c1", "c2" ]);

        // Broken relations table: one valid relation row survives the filter.
        const relRows = root.querySelectorAll("table.table tbody tr");
        expect(relRows.length).toBe(1);
        expect(root.querySelector("table.table tbody td code")?.textContent).toBe("template");
    });

    it("shows the empty-state when no notes are to be deleted and no broken relations", async () => {
        buildNote({ id: "ep", title: "Empty", children: [ { id: "ec", title: "EC" } ] });
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [ "ep_ec" ] });
        await flush();

        expect(root.querySelector(".preview-list")).toBeNull();
        expect(root.querySelector(".muted-text")).not.toBeNull();
        // No broken relations → BrokenRelations returns null.
        expect(root.querySelector("table.table")).toBeNull();
    });

    it("renders the delete-all-clones option when clones exist and includes it in the preview request", async () => {
        // A note cloned under two parents: deleting one branch leaves one "other" branch → one clone.
        const cloned = buildNote({ id: "shared", title: "Shared" });
        const parentA = buildNote({ id: "pa", title: "A" });
        const parentB = buildNote({ id: "pb", title: "B" });
        const branchA = "pa_shared";
        const branchB = "pb_shared";
        // Wire up both parent branches manually.
        for (const [ branchId, parentNote ] of [ [ branchA, parentA ], [ branchB, parentB ] ] as const) {
            const { default: FBranch } = await import("../../entities/fbranch.js");
            const branch = new FBranch(froca, {
                branchId,
                noteId: cloned.noteId,
                parentNoteId: parentNote.noteId,
                notePosition: 0,
                fromSearchNote: false
            });
            froca.branches[branchId] = branch;
            cloned.addParent(parentNote.noteId, branchId, false);
            parentNote.addChild(cloned.noteId, branchId, false);
        }

        setPreview({ noteIdsToBeDeleted: [ "shared" ], brokenRelations: [] });
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [ branchA ] });
        await flush();

        // The clone option row toggle becomes available (two toggles: clones + erase).
        const toggles = root.querySelectorAll(".switch-toggle");
        expect(toggles.length).toBe(2);

        // Toggling delete-all-clones re-requests the preview with deleteAllClones=true.
        const cloneToggle = toggles[0];
        act(() => { cloneToggle.dispatchEvent(new Event("input", { bubbles: true })); });
        await flush();
        expect(server.post).toHaveBeenLastCalledWith("delete-notes-preview", {
            branchIdsToDelete: [ branchA ],
            deleteAllClones: true
        });
    });

    it("forceDeleteAllClones disables the erase toggle and forces deleteAllClones in the request", async () => {
        buildNote({ id: "fp", title: "FP", children: [ { id: "fc", title: "FC" } ] });
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [ "fp_fc" ], forceDeleteAllClones: true });
        await flush();

        expect(server.post).toHaveBeenCalledWith("delete-notes-preview", {
            branchIdsToDelete: [ "fp_fc" ],
            deleteAllClones: true
        });
        // The erase toggle is disabled when clones are force-deleted.
        const eraseInput = root.querySelector(".switch-toggle");
        expect((eraseInput as HTMLInputElement | null)?.disabled).toBe(true);
    });

    it("cancel button hides the modal without calling the callback with proceed=true", async () => {
        const callback = vi.fn();
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [], callback });
        await flush();

        const cancelButton = root.querySelector(".mock-modal-footer button");
        act(() => { (cancelButton as HTMLButtonElement | null)?.click(); });
        await flush();
        expect(root.querySelector(".mock-modal")?.getAttribute("data-shown")).toBe("0");
        // Cancel sets shown=false; the callback fires via onHidden in real usage, not directly here.
        expect(callback).not.toHaveBeenCalledWith({ proceed: true, deleteAllClones: false, eraseNotes: false });
    });

    it("delete button resolves the callback with proceed=true and the chosen options", async () => {
        const callback = vi.fn();
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [], callback });
        await flush();

        const buttons = root.querySelectorAll(".mock-modal-footer button");
        const deleteButton = buttons[buttons.length - 1];
        act(() => { (deleteButton as HTMLButtonElement).click(); });
        await flush();
        expect(callback).toHaveBeenCalledWith({ proceed: true, deleteAllClones: false, eraseNotes: false });
        expect(root.querySelector(".mock-modal")?.getAttribute("data-shown")).toBe("0");
    });

    it("onHidden calls the callback with proceed=false and resets shown state", async () => {
        const callback = vi.fn();
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [], callback });
        await flush();

        const hiddenButton = root.querySelector(".mock-hidden");
        act(() => { (hiddenButton as HTMLButtonElement | null)?.click(); });
        await flush();
        expect(callback).toHaveBeenCalledWith({ proceed: false });
        expect(root.querySelector(".mock-modal")?.getAttribute("data-shown")).toBe("0");
    });

    it("onShown focuses the OK button without throwing", async () => {
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [] });
        await flush();
        const shownButton = root.querySelector(".mock-shown");
        expect(() => act(() => { (shownButton as HTMLButtonElement | null)?.click(); })).not.toThrow();
    });

    it("toggling erase notes updates the erase option used by the delete callback", async () => {
        const callback = vi.fn();
        const root = renderDialog();
        fireShow({ branchIdsToDelete: [], callback });
        await flush();

        // Only the erase toggle is present (no clones).
        const eraseToggle = root.querySelector(".switch-toggle");
        act(() => { eraseToggle?.dispatchEvent(new Event("input", { bubbles: true })); });
        await flush();

        const buttons = root.querySelectorAll(".mock-modal-footer button");
        const deleteButton = buttons[buttons.length - 1];
        act(() => { (deleteButton as HTMLButtonElement).click(); });
        expect(callback).toHaveBeenCalledWith({ proceed: true, deleteAllClones: false, eraseNotes: true });
    });

    it("uses the virtualized list and DeletedNoteRow when over the threshold", async () => {
        const manyIds = Array.from({ length: 120 }, (_, i) => `note${i}`);
        setPreview({ noteIdsToBeDeleted: manyIds, brokenRelations: [] });
        buildNote({ id: "vp", title: "VP", children: [ { id: "vc", title: "VC" } ] });

        const root = renderDialog();
        fireShow({ branchIdsToDelete: [ "vp_vc" ] });
        await flush();

        // The mocked react-window List renders an <ul.preview-list> with one <li> per row.
        const list = root.querySelector("ul.preview-list");
        expect(list).not.toBeNull();
        const rows = root.querySelectorAll("ul.preview-list li .mock-note-link");
        expect(rows.length).toBe(120);
        expect(rows[0].getAttribute("data-note-path")).toBe("note0");
    });
});
