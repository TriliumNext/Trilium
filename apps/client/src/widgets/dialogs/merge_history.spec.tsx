import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import server from "../../services/server";
import toast from "../../services/toast";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import MergeHistoryDialog from "./merge_history";

vi.mock("../../services/i18n", () => ({
    t: (key: string, opts?: { title?: string }) => (opts?.title ? `${key}:${opts.title}` : key)
}));

const undoable = {
    id: "entry-1",
    utcDate: "2026-01-02T15:04:00.000Z",
    sourceTitle: "Alpha",
    sourceNoteId: "alpha",
    undoable: true
};
const expired = {
    id: "entry-2",
    utcDate: "2026-01-01T15:04:00.000Z",
    sourceTitle: "Beta",
    sourceNoteId: "beta",
    undoable: false
};

describe("MergeHistoryDialog", () => {
    async function open(host: Component, noteId = "merged") {
        const container = renderInto(
            <ParentComponent.Provider value={host}>
                <MergeHistoryDialog />
            </ParentComponent.Provider>
        );
        await act(async () => {
            await host.handleEventInChildren("showMergeHistory", { noteId });
        });
        return container;
    }

    it("lists the merges and restores or forgets the one that was asked for", async () => {
        vi.spyOn(server, "get").mockResolvedValue({ entries: [ undoable, expired ] });
        const post = vi.spyOn(server, "post").mockResolvedValue({});
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const host = new Component();
        const container = await open(host);

        expect(container.querySelector(".merge-history-what")?.textContent)
            .toBe("merge_history.merged:Alpha");
        const undoButtons = container.querySelectorAll(".bx-undo");
        expect(undoButtons.length).toBe(1);

        await act(async () => {
            undoButtons[0]?.closest("button")?.click();
        });
        expect(post).toHaveBeenCalledWith("notes/merged/merge-undo", { entryId: "entry-1" });

        const forget = [ ...container.querySelectorAll<HTMLButtonElement>(".merge-history-actions button") ]
            .find((button) => !button.querySelector(".bx-undo"));
        await act(async () => {
            forget?.click();
        });
        expect(post).toHaveBeenCalledWith(
            "notes/merged/merge-history/forget", { entryId: "entry-1" }
        );
        // Undo and forget each say that they finished.
        expect(showMessage).toHaveBeenCalledTimes(2);
    });

    it("shows an empty list when the history cannot be read, and stays quiet when forgetting fails", async () => {
        vi.spyOn(server, "get").mockRejectedValue(new Error("no"));
        const host = new Component();
        const container = await open(host);
        expect(container.querySelector(".merge-history")).toBeNull();

        vi.mocked(server.get).mockResolvedValue({ entries: [ undoable ] });
        const post = vi.spyOn(server, "post").mockRejectedValue(new Error("no"));
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        await act(async () => {
            await host.handleEventInChildren("showMergeHistory", { noteId: "merged" });
        });
        const forget = await vi.waitFor(() => {
            const button = container.querySelector<HTMLButtonElement>(
                ".merge-history-actions button:last-child"
            );
            expect(button).toBeTruthy();
            return button;
        });
        await act(async () => {
            forget?.click();
        });
        expect(post).toHaveBeenCalled();
        expect(showMessage).not.toHaveBeenCalled();
    });

    it("ignores a history response that arrives after the dialog has closed", async () => {
        let resolveGet: (value: { entries: typeof undoable[] }) => void = () => {};
        vi.spyOn(server, "get").mockImplementation(
            () => new Promise((resolve) => {
                resolveGet = resolve;
            })
        );
        const host = new Component();
        const container = await open(host);
        await act(() => {
            render(null, container);
        });
        resolveGet({ entries: [ undoable ] });
        await act(async () => {
            await Promise.resolve();
        });
        expect(container.querySelector(".merge-history")).toBeNull();
    });
});
