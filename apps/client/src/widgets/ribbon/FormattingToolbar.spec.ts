import { NoteType } from "@triliumnext/commons";
import { beforeAll, describe, expect, it, vi } from "vitest";

import NoteContext from "../../components/note_context";
import { ViewMode } from "../../services/link";
import { randomString } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { getFormattingToolbarState } from "./FormattingToolbar";

interface NoteContextInfo {
    type: NoteType;
    viewScope?: ViewMode;
    isReadOnly?: boolean;
}

describe("Formatting toolbar logic", () => {
    beforeAll(() => {
        vi.mock("../../services/tree.ts", () => ({
            default: {
                getActiveContextNotePath() {
                    return "root";
                },
                resolveNotePath(inputNotePath: string) {
                    return inputNotePath;
                },
                getNoteIdFromUrl(url) {
                    return url.split("/").at(-1);
                }
            }
        }));

        buildNote({
            id: "root",
            title: "Root"
        });
    });

    async function buildConfig(noteContextInfos: NoteContextInfo[], activeIndex: number = 0) {
        const noteContexts: NoteContext[] = [];
        for (const noteContextData of noteContextInfos) {
            const noteContext = new NoteContext(randomString(10));
            const note = buildNote({
                title: randomString(5),
                type: noteContextData.type
            });

            noteContext.noteId = note.noteId;
            expect(noteContext.note).toBe(note);
            noteContext.viewScope = {
                viewMode: noteContextData.viewScope ?? "default"
            };
            noteContext.isReadOnly = async () => !!noteContextData.isReadOnly;
            noteContext.getSubContexts = () => [];
            noteContexts.push(noteContext);
        };

        const mainNoteContext = noteContexts[0];
        for (const noteContext of noteContexts) {
            noteContext.getMainContext = () => mainNoteContext;
        }

        mainNoteContext.getSubContexts = () => noteContexts;
        return noteContexts[activeIndex];
    }

    async function testSplit(noteContextInfos: NoteContextInfo[], activeIndex: number = 0, editor = "ckeditor-classic") {
        const noteContext = await buildConfig(noteContextInfos, activeIndex);
        return await getFormattingToolbarState(noteContext, noteContext.note, editor);
    }

    describe("Single split", () => {
        it("should be hidden for floating toolbar", async () => {
            expect(await testSplit([ { type: "text" } ], 0, "ckeditor-balloon")).toBe("hidden");
        });

        it("should be visible for single text note", async () => {
            expect(await testSplit([ { type: "text" } ])).toBe("visible");
        });

        it("should be hidden for read-only text note", async () => {
            expect(await testSplit([ { type: "text", isReadOnly: true } ])).toBe("hidden");
        });

        it("should be hidden for non-text note", async () => {
            expect(await testSplit([ { type: "code" } ])).toBe("hidden");
        });

        it("should be hidden for wrong view mode", async () => {
            expect(await testSplit([ { type: "text", viewScope: "attachments" } ])).toBe("hidden");
        });
    });

    describe("Multi split", () => {
        it("should be hidden for floating toolbar", async () => {
            expect(await testSplit([
                { type: "text" },
                { type: "text" },
            ], 0, "ckeditor-balloon")).toBe("hidden");
        });

        it("should be visible for two text notes", async () => {
            expect(await testSplit([
                { type: "text" },
                { type: "text" },
            ])).toBe("visible");
        });

        it("should be disabled if on a non-text note", async () => {
            expect(await testSplit([
                { type: "text" },
                { type: "code" },
            ], 1)).toBe("disabled");
        });

        it("should be hidden for all non-text notes", async () => {
            expect(await testSplit([
                { type: "code" },
                { type: "canvas" },
            ])).toBe("hidden");
        });

        it("should be hidden for all read-only text notes", async () => {
            expect(await testSplit([
                { type: "text", isReadOnly: true },
                { type: "text", isReadOnly: true },
            ])).toBe("hidden");
        });

        it("should be visible for mixed view mode", async () => {
            expect(await testSplit([
                { type: "text" },
                { type: "text", viewScope: "attachments" }
            ])).toBe("visible");
        });

        it("should be hidden for all wrong view mode", async () => {
            expect(await testSplit([
                { type: "text", viewScope: "attachments" },
                { type: "text", viewScope: "attachments" }
            ])).toBe("hidden");
        });

        it("should be disabled for wrong view mode", async () => {
            expect(await testSplit([
                { type: "text" },
                { type: "text", viewScope: "attachments" }
            ], 1)).toBe("disabled");
        });
    });

});
