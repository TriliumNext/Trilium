import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAttribute } from "../../../services/attributes";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import note_create from "../../../services/note_create";
import { deleteNoteOrBranch } from "../../../services/note_deletion";
import { buildNote } from "../../../test/easy-froca";
import { changeEvent, newEvent, removeFromCalendar } from "./api";

vi.mock("../../../services/attributes", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/attributes")>(),
    setAttribute: vi.fn()
}));

vi.mock("../../../services/dialog", () => ({
    default: { confirmDeleteNoteBoxWithNote: vi.fn() }
}));

vi.mock("../../../services/note_create", () => ({ default: { createNote: vi.fn() } }));
vi.mock("../../../services/note_deletion", () => ({ deleteNoteOrBranch: vi.fn() }));

/** The labels each call wrote or cleared, in order — the name and the value it was set to. */
const writtenLabels = () => vi.mocked(setAttribute).mock.calls.map((call) => [ call[2], call[3] ]);

describe("changeEvent", () => {
    beforeEach(() => vi.mocked(setAttribute).mockClear());

    it("writes the stock labels where the note renames none", async () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });

        await changeEvent(note, { startDate: "2026-06-06", endDate: "2026-06-08", startTime: "13:00", endTime: "14:00" });

        expect(writtenLabels()).toEqual([
            [ "startDate", "2026-06-06" ],
            [ "endDate", "2026-06-08" ],
            [ "startTime", "13:00" ],
            [ "endTime", "14:00" ]
        ]);
    });

    it("writes the labels a note renames for itself, and clears the stock fallback along with a renamed one", async () => {
        const note = buildNote({
            title: "Fair",
            "#calendar:startDate": "myStartDate", "#myStartDate": "2026-06-05",
            "#calendar:endDate": "myEndDate", "#myEndDate": "2026-06-07", "#endDate": "2026-06-06"
        });

        await changeEvent(note, { startDate: "2026-06-09", endDate: null, startTime: null, endTime: null });

        expect(writtenLabels()).toEqual([
            [ "myStartDate", "2026-06-09" ],
            // The stale stock end date goes with the renamed one: left behind, the event builder's
            // fallback would pick it up the moment the renamed label was gone.
            [ "myEndDate", null ],
            [ "endDate", null ],
            [ "startTime", null ],
            [ "endTime", null ]
        ]);
    });

    it("drops an end date equal to the start, a one-day event standing on its start alone", async () => {
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });

        await changeEvent(note, { startDate: "2026-06-06", endDate: "2026-06-06" });

        expect(writtenLabels()).toEqual([
            [ "startDate", "2026-06-06" ],
            [ "endDate", null ],
            [ "startTime", null ],
            [ "endTime", null ]
        ]);
    });
});

describe("newEvent", () => {
    /** What the calendar was handed to create the note with, the note itself being the mock's. */
    const creationRequest = () => {
        const call = vi.mocked(note_create.createNote).mock.calls[0];
        // `createNote` defaults its options, so the recorded argument is optional to the type even
        // though the calendar always passes one.
        if (!call?.[1]) throw new Error("No note was created.");
        return { parentNoteId: call[0], opts: call[1], componentId: call[2] };
    };

    beforeEach(() => {
        vi.mocked(note_create.createNote).mockReset();
        vi.mocked(note_create.createNote).mockResolvedValue({ note: buildNote({ title: "Fair" }) } as never);
    });

    it("writes only the labels it was given, a bare event standing on its start date alone", async () => {
        const calendar = buildNote({ title: "Calendar" });

        await newEvent(calendar, { startDate: "2026-06-05" });

        const { parentNoteId, opts } = creationRequest();
        expect(parentNoteId).toBe(calendar.noteId);
        expect(opts.attributes).toEqual([
            { type: "label", name: "startDate", value: "2026-06-05" }
        ]);
    });

    it("writes every date and hour it was given, in the order the calendar reads them", async () => {
        const calendar = buildNote({ title: "Calendar" });

        await newEvent(calendar, {
            title: "Fair", startDate: "2026-06-05", endDate: "2026-06-07",
            startTime: "13:00", endTime: "14:30", componentId: "comp-1"
        });

        const { opts, componentId } = creationRequest();
        expect(opts.title).toBe("Fair");
        expect(opts.attributes).toEqual([
            { type: "label", name: "startDate", value: "2026-06-05" },
            { type: "label", name: "endDate", value: "2026-06-07" },
            { type: "label", name: "startTime", value: "13:00" },
            { type: "label", name: "endTime", value: "14:30" }
        ]);
        expect(componentId).toBe("comp-1");
    });

    it("leaves out what was given as nothing, rather than writing an empty label for it", async () => {
        const calendar = buildNote({ title: "Calendar" });

        await newEvent(calendar, { startDate: "2026-06-05", endDate: null, startTime: null, endTime: "" });

        expect(creationRequest().opts.attributes).toEqual([
            { type: "label", name: "startDate", value: "2026-06-05" }
        ]);
    });

    it("takes the calendar's protection, and hands the new note back for the pane to open on", async () => {
        const calendar = buildNote({ title: "Calendar" });
        const created = buildNote({ title: "Fair" });
        vi.mocked(note_create.createNote).mockResolvedValue({ note: created } as never);

        expect(await newEvent(calendar, { startDate: "2026-06-05" })).toBe(created);

        const { opts } = creationRequest();
        expect(opts.isProtected).toBe(calendar.isProtected);
        // The note is not switched to: the pane opens on it where the calendar stands.
        expect(opts.activate).toBe(false);
    });
});

describe("removeFromCalendar", () => {
    beforeEach(() => vi.mocked(setAttribute).mockClear());

    it("clears the start date under both its names, so the fallback cannot keep the event on", async () => {
        vi.mocked(dialog.confirmDeleteNoteBoxWithNote)
            .mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });
        const calendar = buildNote({ title: "Calendar" });
        // The renaming is configured but unfilled, so the event stands on the stock label alone —
        // removing only the renamed one would leave it on the calendar.
        const note = buildNote({ title: "Fair", "#calendar:startDate": "myStartDate", "#startDate": "2026-06-05" });

        expect(await removeFromCalendar(note, calendar)).toBe(true);
        expect(writtenLabels()).toEqual([
            [ "myStartDate", null ],
            [ "startDate", null ]
        ]);
    });

    it("deletes the note by the calendar's own branch where that was asked for as well", async () => {
        vi.mocked(dialog.confirmDeleteNoteBoxWithNote)
            .mockResolvedValue({ confirmed: true, isDeleteNoteChecked: true });
        const calendar = buildNote({
            title: "Calendar",
            children: [ { id: "doomedEvent", title: "Fair", "#startDate": "2026-06-05" } ]
        });
        const note = froca.notes["doomedEvent"];

        expect(await removeFromCalendar(note, calendar)).toBe(true);
        // The branch the calendar holds it by, which is what tells a note cloned in from elsewhere
        // from one that lives here and nowhere else.
        expect(deleteNoteOrBranch).toHaveBeenCalledWith("doomedEvent", note.parentToBranch[calendar.noteId]);
        expect(note.parentToBranch[calendar.noteId]).toBeTruthy();
        // The labels are left alone: the note is going, not merely coming off the calendar.
        expect(setAttribute).not.toHaveBeenCalled();
    });

    it("does nothing where the dialog was dismissed", async () => {
        vi.mocked(dialog.confirmDeleteNoteBoxWithNote).mockResolvedValue(undefined);
        const calendar = buildNote({ title: "Calendar" });
        const note = buildNote({ title: "Fair", "#startDate": "2026-06-05" });

        expect(await removeFromCalendar(note, calendar)).toBe(false);
        expect(setAttribute).not.toHaveBeenCalled();
    });
});
