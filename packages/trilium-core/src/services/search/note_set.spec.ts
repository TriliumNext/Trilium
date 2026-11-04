import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import NoteSet from "./note_set.js";

describe("NoteSet", () => {
    let a: BNote;
    let b: BNote;
    let c: BNote;

    beforeEach(() => {
        becca.reset();
        a = buildNote({ id: "a", title: "A" });
        b = buildNote({ id: "b", title: "B" });
        c = buildNote({ id: "c", title: "C" });
    });

    describe("constructor", () => {
        it("defaults to an empty, unsorted set", () => {
            const set = new NoteSet();

            expect(set.notes).toEqual([]);
            expect(set.sorted).toBe(false);
            expect(set.hasNoteId("a")).toBe(false);
        });

        it("seeds notes and indexes their ids", () => {
            const set = new NoteSet([a, b]);

            expect(set.notes).toEqual([a, b]);
            expect(set.hasNote(a)).toBe(true);
            expect(set.hasNote(b)).toBe(true);
            expect(set.hasNote(c)).toBe(false);
            expect(set.hasNoteId("a")).toBe(true);
            expect(set.hasNoteId("missing")).toBe(false);
        });
    });

    describe("add", () => {
        it("adds a new note and indexes its id", () => {
            const set = new NoteSet();

            set.add(a);

            expect(set.notes).toEqual([a]);
            expect(set.hasNote(a)).toBe(true);
            expect(set.hasNoteId("a")).toBe(true);
        });

        it("ignores a note whose id is already present (deduplicates)", () => {
            const set = new NoteSet([a]);
            // distinct BNote instance sharing the same noteId
            const aDuplicate = buildNote({ id: "a", title: "A again" });

            set.add(a);
            set.add(aDuplicate);

            expect(set.notes).toEqual([a]);
            expect(set.notes).toHaveLength(1);
        });
    });

    describe("addAll", () => {
        it("adds every note while deduplicating against existing ids", () => {
            const set = new NoteSet([a]);

            set.addAll([a, b, c]);

            expect(set.notes).toEqual([a, b, c]);
        });

        it("is a no-op for an empty array", () => {
            const set = new NoteSet([a]);

            set.addAll([]);

            expect(set.notes).toEqual([a]);
        });
    });

    describe("hasNote / hasNoteId", () => {
        it("reports membership by note and by id consistently", () => {
            const set = new NoteSet([a]);

            expect(set.hasNote(a)).toBe(true);
            expect(set.hasNoteId("a")).toBe(true);
            expect(set.hasNote(b)).toBe(false);
            expect(set.hasNoteId("b")).toBe(false);
        });
    });

    describe("mergeIn", () => {
        it("absorbs all notes from another set, deduplicating overlaps", () => {
            const set = new NoteSet([a, b]);
            const other = new NoteSet([b, c]);

            set.mergeIn(other);

            expect(set.notes).toEqual([a, b, c]);
            // the source set is left untouched
            expect(other.notes).toEqual([b, c]);
        });

        it("merging an empty set changes nothing", () => {
            const set = new NoteSet([a]);

            set.mergeIn(new NoteSet());

            expect(set.notes).toEqual([a]);
        });
    });

    describe("minus", () => {
        it("returns a new set of notes not present in the other set", () => {
            const set = new NoteSet([a, b, c]);
            const other = new NoteSet([b]);

            const result = set.minus(other);

            expect(result).toBeInstanceOf(NoteSet);
            expect(result.notes).toEqual([a, c]);
            // operands are not mutated
            expect(set.notes).toEqual([a, b, c]);
            expect(other.notes).toEqual([b]);
        });

        it("returns all notes when subtracting an empty set", () => {
            const set = new NoteSet([a, b]);

            expect(set.minus(new NoteSet()).notes).toEqual([a, b]);
        });

        it("returns an empty set when every note is removed", () => {
            const set = new NoteSet([a, b]);
            const other = new NoteSet([a, b, c]);

            expect(set.minus(other).notes).toEqual([]);
        });
    });

    describe("intersection", () => {
        it("returns a new set of notes present in both sets", () => {
            const set = new NoteSet([a, b, c]);
            const other = new NoteSet([b, c]);

            const result = set.intersection(other);

            expect(result).toBeInstanceOf(NoteSet);
            expect(result.notes).toEqual([b, c]);
            // operands are not mutated
            expect(set.notes).toEqual([a, b, c]);
            expect(other.notes).toEqual([b, c]);
        });

        it("returns an empty set when there is no overlap", () => {
            const set = new NoteSet([a]);
            const other = new NoteSet([b]);

            expect(set.intersection(other).notes).toEqual([]);
        });

        it("intersecting with an empty set yields an empty set", () => {
            const set = new NoteSet([a, b]);

            expect(set.intersection(new NoteSet()).notes).toEqual([]);
        });
    });
});
