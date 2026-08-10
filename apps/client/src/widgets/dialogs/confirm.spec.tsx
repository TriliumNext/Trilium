/**
 * The confirmation that offers to delete the note as well as take it off whatever is showing it.
 *
 * What matters here is the offer's honesty. The dialog is handed only the note and the branch the
 * view files it under, and works out for itself what ticking the box would cost — a caller that had
 * to answer that for itself would be a caller that could get it wrong. And a tick must not survive
 * into the next thing the dialog is asked about, it being mounted once for the whole session (see
 * LazyDialog in layout_commons).
 */
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ConfirmDialog from "./confirm";

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: object) => (values ? `${key}:${JSON.stringify(values)}` : key)
}));

describe("ConfirmDialog", () => {
    let host: Component;
    let container: HTMLElement;

    beforeEach(() => {
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <ConfirmDialog />
            </ParentComponent.Provider>
        );
    });

    /**
     * A note filed under the given view and cloned into as many other places as asked for, which is
     * the whole of what decides the sentence the dialog shows.
     */
    function buildSubject(noteId: string, viewNoteId: string, otherPlaces = 0) {
        buildNote({ id: viewNoteId, title: viewNoteId, children: [ { id: noteId, title: "A note" } ] });

        for (let i = 0; i < otherPlaces; i++) {
            froca.notes[noteId].addParent(`other${i}`, `other${i}_${noteId}`, false);
        }
    }

    /** Asks to remove a note, as the relation map's own "Remove note" asks. */
    async function askAboutNote(deletionTarget?: { noteId: string; branchId?: string | null }) {
        await act(async () => {
            void host.handleEventInChildren("showConfirmDeleteNoteBoxWithNoteDialog", {
                title: "A note",
                callback: () => {},
                deletionTarget
            });
        });
    }

    function checkbox() {
        return container.querySelector<HTMLInputElement>("input[type=checkbox]");
    }

    function outcome() {
        return container.querySelector(".confirm-delete-note-outcome")?.textContent;
    }

    async function tick(checked: boolean) {
        const input = checkbox();
        if (!input) throw new Error("The dialog offered no checkbox to tick.");
        await act(async () => {
            input.checked = checked;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    /**
     * The note hangs nowhere else, so ticking would take it out of the tree — which the dialog works
     * out from the branch alone, nobody having told it so.
     */
    it("says what leaving the box alone means, and what ticking it would cost", async () => {
        buildSubject("lonely", "theview");
        await askAboutNote({ noteId: "lonely", branchId: "theview_lonely" });

        expect(outcome()).toBe("confirm.if_you_dont_check");

        await tick(true);
        expect(outcome()).toBe("confirm.delete_note_deletes_note");

        // Both ways round: unticking says the harmless thing again.
        await tick(false);
        expect(outcome()).toBe("confirm.if_you_dont_check");
    });

    /** The same tick on a note that hangs elsewhere too costs it only this one placement. */
    it("says the note is kept where the branch is one of several it hangs from", async () => {
        buildSubject("cloned", "theview", 2);
        await askAboutNote({ noteId: "cloned", branchId: "theview_cloned" });

        await tick(true);
        expect(outcome()).toBe(`confirm.delete_note_keeps_note:${JSON.stringify({ count: 2 })}`);
    });

    /**
     * The dialog is mounted once and lives for the session, so its state is not swept away between
     * openings the way an unmounted component's would be. A tick left standing was a destructive
     * default carried over to another note, and to whichever part of the app asked next.
     */
    it("does not carry a tick over into the next note it is asked about", async () => {
        buildSubject("first", "theview");
        await askAboutNote({ noteId: "first", branchId: "theview_first" });
        await tick(true);
        expect(checkbox()?.checked).toBe(true);

        buildSubject("second", "theview");
        await askAboutNote({ noteId: "second", branchId: "theview_second" });

        expect(checkbox()?.checked).toBe(false);
        expect(outcome()).toBe("confirm.if_you_dont_check");
    });

    /** A caller that names no note gets the box bare, as it was before the dialog could tell. */
    it("offers the box without a verdict where it was told nothing to judge", async () => {
        await askAboutNote();

        await tick(true);
        expect(checkbox()).toBeTruthy();
        expect(outcome()).toBe("");
    });

    it("offers nothing to tick when it is only being asked to confirm", async () => {
        await act(async () => {
            void host.handleEventInChildren("showConfirmDialog", {
                message: "Sure?",
                callback: () => {}
            });
        });

        expect(checkbox()).toBeNull();
        expect(container.querySelector(".confirm-delete-note-outcome")).toBeNull();
    });
});
