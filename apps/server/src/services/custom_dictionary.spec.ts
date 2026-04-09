import { describe, it, expect, vi, beforeEach } from "vitest";
import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import customDictionary from "./custom_dictionary.js";

vi.mock("./log.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock("./sql.js", () => ({
    default: {
        transactional: (cb: Function) => cb(),
        execute: () => {},
        replace: () => {},
        getMap: () => {},
        getValue: () => null,
        upsert: () => {}
    }
}));

function mockSession(localWords: string[] = []) {
    return {
        listWordsInSpellCheckerDictionary: vi.fn().mockResolvedValue(localWords),
        addWordToSpellCheckerDictionary: vi.fn(),
        removeWordFromSpellCheckerDictionary: vi.fn()
    } as any;
}

describe("custom_dictionary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        becca.reset();
        buildNote({
            id: "_customDictionary",
            title: "Custom Dictionary",
            type: "code",
            content: ""
        });
    });

    describe("loadForSession", () => {
        it("does nothing when note is empty and no local words", async () => {
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
            expect(session.removeWordFromSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("imports local words when note is empty (one-time import)", async () => {
            const session = mockSession(["hello", "world"]);

            await customDictionary.loadForSession(session);

            // Words are saved to the note; they're already in the local dictionary so no re-add needed.
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("does not remove or re-add local words after one-time import", async () => {
            const session = mockSession(["hello", "world"]);

            await customDictionary.loadForSession(session);

            // Words were imported from local, so they already exist — no remove, no re-add.
            expect(session.removeWordFromSpellCheckerDictionary).not.toHaveBeenCalled();
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });

        it("loads note words into session when no local words exist", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(2);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
        });

        it("only adds note words not already in local dictionary", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "banana" is already local, so only "apple" needs adding.
            const session = mockSession(["banana", "cherry"]);

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
        });

        it("only removes local words not in the note", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "cherry" is not in the note, so it should be removed. "banana" should stay.
            const session = mockSession(["banana", "cherry"]);

            await customDictionary.loadForSession(session);

            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith("cherry");
        });

        it("handles note with whitespace and blank lines", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "  apple \n\n  banana  \n\n"
            });
            const session = mockSession();

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledTimes(2);
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("apple");
            expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("banana");
        });

        it("does not re-add words removed from the note but present locally", async () => {
            becca.reset();
            buildNote({
                id: "_customDictionary",
                title: "Custom Dictionary",
                type: "code",
                content: "apple\nbanana"
            });
            // "cherry" was previously in the note but user removed it;
            // it still lingers in Electron's local dictionary.
            const session = mockSession(["apple", "banana", "cherry"]);

            await customDictionary.loadForSession(session);

            // "apple" and "banana" are already local — no re-add needed.
            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
            // "cherry" should be removed from local dictionary.
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledTimes(1);
            expect(session.removeWordFromSpellCheckerDictionary).toHaveBeenCalledWith("cherry");
        });

        it("handles missing dictionary note gracefully", async () => {
            becca.reset(); // no note created
            const session = mockSession(["hello"]);

            await customDictionary.loadForSession(session);

            expect(session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
        });
    });
});
