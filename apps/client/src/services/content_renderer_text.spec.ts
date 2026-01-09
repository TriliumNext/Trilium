import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca";
import renderText from "./content_renderer_text";

describe("Text content renderer", () => {
    it("renders included note", async () => {
        const contentEl = document.createElement("div");
        const includedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${includedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(1);
        expect(contentEl.querySelectorAll("section.include-note p").length).toBe(1);
    });

    it("skips rendering included note", async () => {
        const contentEl = document.createElement("div");
        const includedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${includedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl), { noIncludedNotes: true });
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(0);
    });

    it("doesn't enter infinite loop on direct recursion", async () => {
        const contentEl = document.createElement("div");
        const note = buildNote({
            title: "New note",
            id: "Y7mBwmRjQyb4",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="Y7mBwmRjQyb4" data-box-size="medium">
                    &nbsp;
                </section>
                <section class="include-note" data-note-id="Y7mBwmRjQyb4" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(0);
    });

    it("doesn't enter infinite loop on indirect recursion", async () => {
        const contentEl = document.createElement("div");
        buildNote({
            id: "first",
            title: "Included note",
            content: trimIndentation`\
                <p>This is the included note.</p>
                <section class="include-note" data-note-id="second" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        const note = buildNote({
            id: "second",
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="first" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(1);
    });

    it("renders children list when note is empty", async () => {
        const contentEl = document.createElement("div");
        const parentNote = buildNote({
            title: "Parent note",
            children: [
                { title: "Child note 1" },
                { title: "Child note 2" }
            ]
        });
        await renderText(parentNote, $(contentEl));
        const items = contentEl.querySelectorAll("a");
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe("Child note 1");
        expect(items[1].textContent).toBe("Child note 2");
    });

    it("skips archived notes in children list", async () => {
        const contentEl = document.createElement("div");
        const parentNote = buildNote({
            title: "Parent note",
            children: [
                { title: "Child note 1" },
                { title: "Child note 2", "#archived": "" },
                { title: "Child note 3" }
            ]
        });
        await renderText(parentNote, $(contentEl));
        const items = contentEl.querySelectorAll("a");
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe("Child note 1");
        expect(items[1].textContent).toBe("Child note 3");
    });
});
