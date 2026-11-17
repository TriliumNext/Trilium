import { NoteType } from "@triliumnext/commons";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import { ViewMode } from "../../services/link";
import options from "../../services/options";
import { randomString } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import { FixedFormattingToolbar, getFormattingToolbarState } from "./FormattingToolbar";

const active = vi.hoisted(() => ({ note: null as FNote | null, noteContext: undefined as NoteContext | undefined }));
vi.mock("../react/hooks/tree", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks/tree")>()),
    useActiveNoteContext: () => ({ note: active.note, noteContext: active.noteContext, ntxId: active.noteContext?.ntxId })
}));

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

interface NoteContextInfo {
    type: NoteType;
    viewScope?: ViewMode;
    isReadOnly?: boolean;
}

describe("Formatting toolbar logic", () => {
    beforeAll(() => {
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


    describe("FixedFormattingToolbar", () => {
        // A note's auto read-only check waits for its content, which arrives after the note shows.
        function renderWithPendingReadOnlyCheck(attributes: Record<string, string> = {}) {
            options.set("textNoteEditorType", "ckeditor-classic");
            const note = buildNote({ title: randomString(5), type: "text", ...attributes });
            const noteContext = new NoteContext(randomString(10));
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            noteContext.isReadOnly = () => new Promise<boolean>(() => {});
            noteContext.getSubContexts = () => [ noteContext ];
            noteContext.getMainContext = () => noteContext;
            active.note = note;
            active.noteContext = noteContext;

            const parent = { registerHandler: () => {}, removeHandler: () => {} } as unknown as Component;
            const container = document.createElement("div");
            act(() => render(h(ParentComponent.Provider, { value: parent }, h(FixedFormattingToolbar, null)), container));
            const toolbar = container.querySelector(".classic-toolbar-widget");
            expect(toolbar).toBeInstanceOf(HTMLElement);
            act(() => render(null, container));
            return toolbar;
        }

        it("shows for an editable text note before its auto read-only check settles", () => {
            expect(renderWithPendingReadOnlyCheck()?.classList.contains("hidden-ext")).toBe(false);
        });

        it("stays hidden for a read-only text note while the check is pending", () => {
            expect(renderWithPendingReadOnlyCheck({ "#readOnly": "" })?.classList.contains("hidden-ext")).toBe(true);
        });
    });
});
