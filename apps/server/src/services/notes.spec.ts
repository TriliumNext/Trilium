import { beforeAll, describe, expect, it } from "vitest";
import sql_init from "./sql_init";
import cls from "./cls";
import {newEntityId} from "./utils";
import notes from "./notes";
import becca from "../becca/becca";
import {buildNote} from "../test/becca_easy_mocking";

describe("Notes Title", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    describe("setting titleTemplate label should set the notes title when created from template", () => {
        const parentNote = buildNote({
            title: "randomNote"
        });

        it("uses #titleTemplate from the selected template note when creating a note from template", () => {
            cls.init(() => {
                const templateNoteId = newEntityId();

                const templateNote = notes.createNewNote({
                    parentNoteId: parentNote.noteId,
                    noteId: templateNoteId,
                    title: "Test template",
                    type: "text",
                    content: ""
                }).note;

                templateNote.setLabel("titleTemplate", "Hello from template");
                templateNote.setLabel("template");
                templateNote.invalidateThisCache(); // ensures getLabelValue sees the new label

                const created = notes.createNewNote({
                    parentNoteId: parentNote.noteId,
                    templateNoteId: templateNote.noteId,
                    title: null as never, // let notes service derive the title from the template label
                    type: "text",
                    content: ""
                }).note;

                expect(created.title).toBe("Hello from template");

                // sanity: ensure the template note is actually the one we set up
                expect(becca.getNote(templateNoteId)?.getLabelValue("titleTemplate")).toBe("Hello from template");
            });
        });
    });

});
