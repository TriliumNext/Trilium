import { describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import attributeService from "../attributes.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import { runReasoning } from "./reasoning.js";

describe("reasoning on notes", () => {
    it("writes a scoped conclusion and retracts it when the fact it depends on is gone", async () => {
        await getContext().init(async () => {
            const project = noteService.createNewNote({
                parentNoteId: "root",
                title: "Project",
                content: "",
                type: "book"
            }).note;
            const task = noteService.createNewNote({
                parentNoteId: project.noteId,
                title: "Write",
                content: "",
                type: "text"
            }).note;
            const bystander = noteService.createNewNote({
                parentNoteId: "root",
                title: "Bystander",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(task.noteId, "status", "todo");
            attributeService.createLabel(bystander.noteId, "status", "todo");
            attributeService.createLabel(task.noteId, "priority", "high");

            const rules = noteService.createNewNote({
                parentNoteId: project.noteId,
                title: "Rules",
                type: "code",
                mime: "text/plain",
                content: [
                    `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
                    `#mark(?x, "yes") :- #status(?x, "todo").`
                ].join("\n")
            }).note;
            attributeService.createLabel(rules.noteId, "reasoningRule", "");

            const first = await runReasoning();
            expect(first.errors.map((error) => error.noteId)).toEqual([rules.noteId]);
            expect(task.getOwnedAttributes("label", "priority")).toHaveLength(1);
            expect(task.getOwnedAttribute("label", "priority")?.value).toBe("high");
            expect(task.getOwnedAttribute("label", "mark")).toBeNull();
            expect(bystander.getOwnedAttribute("label", "priority")).toBeNull();

            const status = task.getOwnedAttribute("label", "status");
            expect(status).toBeTruthy();
            if (status) {
                status.value = "done";
                status.save();
            }
            await runReasoning();
            // The manual priority label stays; the rule no longer adds another one.
            expect(task.getOwnedAttributes("label", "priority")).toHaveLength(1);
            expect(task.getOwnedAttribute("label", "mark")).toBeNull();

            rules.setContent(`#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`);
            await runReasoning();
            expect(rules.getOwnedAttribute("label", "reasoningError")).toBeNull();
        });
    });

    it("retracts an inferred label and lets a citation outside the subtree become a relation", async () => {
        await getContext().init(async () => {
            const book = noteService.createNewNote({
                parentNoteId: "root",
                title: "The Lord of the Rings",
                content: "",
                type: "text"
            }).note;
            const essay = noteService.createNewNote({
                parentNoteId: "root",
                title: "Essay",
                content: "",
                type: "text"
            }).note;
            attributeService.createRelation(essay.noteId, "cites", book.noteId);
            const task = noteService.createNewNote({
                parentNoteId: book.noteId,
                title: "Chapter",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(task.noteId, "status", "todo");

            noteService.createNewNote({
                parentNoteId: book.noteId,
                title: "Rules",
                type: "code",
                mime: "text/plain",
                content: [
                    `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
                    `~listed(?citing, ?this) :- ~cites(?citing, ?this).`
                ].join("\n"),
                attributes: [{ type: "label", name: "reasoningRule", value: "" }]
            });

            const report = await runReasoning();
            expect(report.errors).toEqual([]);
            expect(task.getOwnedAttribute("label", "priority")?.value).toBe("high");
            expect(essay.getOwnedRelations("listed")[0]?.value).toBe(book.noteId);

            const status = task.getOwnedAttribute("label", "status");
            if (status) {
                status.value = "done";
                status.save();
            }
            await runReasoning();
            expect(task.getOwnedAttribute("label", "priority")).toBeNull();
            expect(essay.getOwnedRelations("listed")[0]?.value).toBe(book.noteId);
        });
    });

    it("applies a template's rules to each instance and a global rule only from a schema note", async () => {
        await getContext().init(async () => {
            const projekt = noteService.createNewNote({
                parentNoteId: "root",
                title: "Projekt",
                content: "",
                type: "text",
                attributes: [{ type: "label", name: "template", value: "" }]
            }).note;
            noteService.createNewNote({
                parentNoteId: projekt.noteId,
                title: "Projekt rules",
                type: "code",
                mime: "text/plain",
                content: `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
                attributes: [{ type: "label", name: "reasoningRule", value: "" }]
            });

            const website = noteService.createNewNote({
                parentNoteId: "root",
                title: "Website",
                content: "",
                type: "book"
            }).note;
            const css = noteService.createNewNote({
                parentNoteId: website.noteId,
                title: "CSS",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(css.noteId, "status", "todo");
            attributeService.createRelation(website.noteId, "template", projekt.noteId);

            const loose = noteService.createNewNote({
                parentNoteId: "root",
                title: "Loose todo",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(loose.noteId, "status", "todo");

            await runReasoning();
            expect(css.getOwnedAttribute("label", "priority")?.value).toBe("high");
            expect(loose.getOwnedAttribute("label", "priority")).toBeNull();

            const schema = noteService.createNewNote({
                parentNoteId: "root",
                title: "Priesthood",
                content: `#vollmacht(?person, "Ja") :- #rolle(?person, "Priester").`,
                type: "code",
                mime: "text/plain",
                attributes: [
                    { type: "label", name: "reasoningRule", value: "" },
                    { type: "label", name: "reasoningScope", value: "global" }
                ]
            }).note;
            const johannes = noteService.createNewNote({
                parentNoteId: "root",
                title: "Johannes",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(johannes.noteId, "rolle", "Priester");

            const refused = await runReasoning();
            expect(refused.errors.some((error) => error.noteId === schema.noteId)).toBe(true);
            expect(johannes.getOwnedAttribute("label", "vollmacht")).toBeNull();

            attributeService.createLabel(schema.noteId, "reasoningSchema", "");
            const allowed = await runReasoning();
            expect(allowed.errors.some((error) => error.noteId === schema.noteId)).toBe(false);
            expect(johannes.getOwnedAttribute("label", "vollmacht")?.value).toBe("Ja");
            expect(loose.getOwnedAttribute("label", "vollmacht")).toBeNull();
            expect(becca.notes[schema.noteId]?.getOwnedAttribute("label", "reasoningError")).toBeNull();
        });
    });
});
