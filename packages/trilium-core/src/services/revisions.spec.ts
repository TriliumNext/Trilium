import { afterEach, describe, expect, it, vi } from "vitest";

import { getLog } from "./log.js";
import protectedSessionService from "./protected_session.js";
import revisionService from "./revisions.js";
import type BNote from "../becca/entities/bnote.js";

/**
 * `protectRevisions` only ever calls a handful of methods on the note, its
 * revisions and their attachments. It performs no SQL of its own (the writes
 * happen inside the entities' `setContent`), so the behaviour can be exercised
 * with lightweight fakes that record the calls made against them. The only
 * external dependency that needs taming is the protected-session availability
 * check, which we drive via a spy.
 */

interface SetContentCall {
    content: string | Uint8Array;
    opts?: { forceSave?: boolean };
}

function fakeAttachment(opts: { isProtected: boolean; content?: string; throwOnSet?: boolean }) {
    const setContentCalls: SetContentCall[] = [];

    return {
        attachmentId: "att1",
        isProtected: opts.isProtected,
        getContent: vi.fn(() => opts.content ?? "att-content"),
        setContent: vi.fn(function (this: { isProtected: boolean }, content: string | Uint8Array, o?: { forceSave?: boolean }) {
            if (opts.throwOnSet) {
                throw new Error("attachment setContent boom");
            }
            setContentCalls.push({ content, opts: o });
        }),
        setContentCalls
    };
}

type FakeAttachment = ReturnType<typeof fakeAttachment>;

function fakeRevision(opts: {
    isProtected: boolean;
    content?: string;
    attachments?: FakeAttachment[];
    throwOnSet?: boolean;
}) {
    const setContentCalls: SetContentCall[] = [];
    const attachments = opts.attachments ?? [];

    return {
        revisionId: "rev1",
        isProtected: opts.isProtected,
        getContent: vi.fn(() => opts.content ?? "rev-content"),
        setContent: vi.fn(function (this: { isProtected: boolean }, content: string | Uint8Array, o?: { forceSave?: boolean }) {
            if (opts.throwOnSet) {
                throw new Error("revision setContent boom");
            }
            setContentCalls.push({ content, opts: o });
        }),
        getAttachments: vi.fn(() => attachments),
        setContentCalls
    };
}

type FakeRevision = ReturnType<typeof fakeRevision>;

function fakeNote(opts: { isProtected: boolean; revisions?: FakeRevision[] }): BNote {
    return {
        noteId: "note1",
        isProtected: opts.isProtected,
        getRevisions: vi.fn(() => opts.revisions ?? [])
    } as unknown as BNote;
}

describe("revisions.protectRevisions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("throws and touches nothing when no protected session is available", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(false);

        const revision = fakeRevision({ isProtected: false });
        const note = fakeNote({ isProtected: true, revisions: [revision] });

        expect(() => revisionService.protectRevisions(note)).toThrow(/active protected session/);
        // The note's revisions must not even be enumerated when the guard fails.
        expect((note.getRevisions as any)).not.toHaveBeenCalled();
        expect(revision.setContent).not.toHaveBeenCalled();
    });

    it("re-protects revisions and attachments whose flag differs from the note (force save, copies content)", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);

        const attachment = fakeAttachment({ isProtected: false, content: "att-body" });
        const revision = fakeRevision({ isProtected: false, content: "rev-body", attachments: [attachment] });
        const note = fakeNote({ isProtected: true, revisions: [revision] });

        revisionService.protectRevisions(note);

        // Content is read once, then re-saved with forceSave so de/encryption runs.
        expect(revision.getContent).toHaveBeenCalledTimes(1);
        expect(revision.isProtected).toBe(true);
        expect(revision.setContentCalls).toEqual([{ content: "rev-body", opts: { forceSave: true } }]);

        expect(attachment.getContent).toHaveBeenCalledTimes(1);
        expect(attachment.isProtected).toBe(true);
        expect(attachment.setContentCalls).toEqual([{ content: "att-body", opts: { forceSave: true } }]);
    });

    it("flips both directions: an unprotected note de-protects its previously protected revision", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);

        const attachment = fakeAttachment({ isProtected: true });
        const revision = fakeRevision({ isProtected: true, attachments: [attachment] });
        const note = fakeNote({ isProtected: false, revisions: [revision] });

        revisionService.protectRevisions(note);

        expect(revision.isProtected).toBe(false);
        expect(revision.setContent).toHaveBeenCalledTimes(1);
        expect(attachment.isProtected).toBe(false);
        expect(attachment.setContent).toHaveBeenCalledTimes(1);
    });

    it("skips entities already matching the note's protection state", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);

        const matchingAttachment = fakeAttachment({ isProtected: true });
        const differingAttachment = fakeAttachment({ isProtected: false });
        const revision = fakeRevision({
            isProtected: true,
            attachments: [matchingAttachment, differingAttachment]
        });
        const note = fakeNote({ isProtected: true, revisions: [revision] });

        revisionService.protectRevisions(note);

        // Revision already matches -> not re-encrypted.
        expect(revision.getContent).not.toHaveBeenCalled();
        expect(revision.setContent).not.toHaveBeenCalled();

        // Only the attachment whose flag differs gets updated.
        expect(matchingAttachment.setContent).not.toHaveBeenCalled();
        expect(differingAttachment.setContent).toHaveBeenCalledTimes(1);
        expect(differingAttachment.isProtected).toBe(true);
    });

    it("processes every revision of the note", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);

        const revA = fakeRevision({ isProtected: false });
        const revB = fakeRevision({ isProtected: false });
        const note = fakeNote({ isProtected: true, revisions: [revA, revB] });

        revisionService.protectRevisions(note);

        expect(revA.setContent).toHaveBeenCalledTimes(1);
        expect(revB.setContent).toHaveBeenCalledTimes(1);
    });

    it("rethrows and logs when a revision's setContent fails", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);
        const errorSpy = vi.spyOn(getLog(), "error").mockImplementation(() => {});

        const revision = fakeRevision({ isProtected: false, throwOnSet: true });
        const note = fakeNote({ isProtected: true, revisions: [revision] });

        expect(() => revisionService.protectRevisions(note)).toThrow("revision setContent boom");
        // isProtected is mutated to the target value before the failing setContent.
        expect(revision.isProtected).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });

    it("rethrows and logs when an attachment's setContent fails", () => {
        vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);
        const errorSpy = vi.spyOn(getLog(), "error").mockImplementation(() => {});

        const attachment = fakeAttachment({ isProtected: false, throwOnSet: true });
        const revision = fakeRevision({ isProtected: true, attachments: [attachment] });
        const note = fakeNote({ isProtected: true, revisions: [revision] });

        expect(() => revisionService.protectRevisions(note)).toThrow("attachment setContent boom");
        expect(attachment.isProtected).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });
});
