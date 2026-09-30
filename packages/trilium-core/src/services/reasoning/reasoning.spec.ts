import { describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import attributeService from "../attributes.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import { inferredAttributeIds, releaseInferred, runReasoning, runReasoningOn } from "./reasoning.js";

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
            expect(first.errors.map((error) => error.noteId)).not.toContain(rules.noteId);
            expect(task.getOwnedAttributes("label", "priority")).toHaveLength(1);
            expect(task.getOwnedAttribute("label", "priority")?.value).toBe("high");
            expect(task.getOwnedAttribute("label", "mark")?.value).toBe("yes");
            expect(bystander.getOwnedAttribute("label", "mark")?.value).toBe("yes");
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
            expect(bystander.getOwnedAttribute("label", "mark")?.value).toBe("yes");

            rules.setContent(`#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`);
            await runReasoning();
            expect(bystander.getOwnedAttribute("label", "mark")).toBeNull();
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

    it("applies a template's rules to each instance and a free rule to its workspace", async () => {
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

            const parish = noteService.createNewNote({
                parentNoteId: "root",
                title: "Parish",
                content: "",
                type: "book",
                attributes: [{ type: "label", name: "workspace", value: "" }]
            }).note;
            const schema = noteService.createNewNote({
                parentNoteId: parish.noteId,
                title: "Priesthood",
                content: `#vollmacht(?person, "Ja") :- #rolle(?person, "Priester").`,
                type: "code",
                mime: "text/plain",
                attributes: [{ type: "label", name: "reasoningRule", value: "" }]
            }).note;
            const johannes = noteService.createNewNote({
                parentNoteId: parish.noteId,
                title: "Johannes",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(johannes.noteId, "rolle", "Priester");
            const outsider = noteService.createNewNote({
                parentNoteId: "root",
                title: "Outsider",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(outsider.noteId, "rolle", "Priester");

            const scoped = await runReasoning();
            expect(scoped.errors.some((error) => error.noteId === schema.noteId)).toBe(false);
            expect(johannes.getOwnedAttribute("label", "vollmacht")?.value).toBe("Ja");
            expect(outsider.getOwnedAttribute("label", "vollmacht")).toBeNull();
            expect(loose.getOwnedAttribute("label", "vollmacht")).toBeNull();

            attributeService.createLabel(schema.noteId, "reasoningScope", "global");
            const allowed = await runReasoning();
            expect(allowed.errors.some((error) => error.noteId === schema.noteId)).toBe(false);
            expect(outsider.getOwnedAttribute("label", "vollmacht")?.value).toBe("Ja");
            expect(becca.notes[schema.noteId]?.getOwnedAttribute("label", "reasoningError")).toBeNull();
        });
    });

    it("stops owning an inferred label when it is kept or its value is edited", async () => {
        await getContext().init(async () => {
            const project = noteService.createNewNote({
                parentNoteId: "root",
                title: "Kept project",
                content: "",
                type: "book"
            }).note;
            const task = noteService.createNewNote({
                parentNoteId: project.noteId,
                title: "Kept task",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(task.noteId, "status", "todo");
            const rules = noteService.createNewNote({
                parentNoteId: project.noteId,
                title: "Kept rules",
                type: "code",
                mime: "text/plain",
                content: `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`
            }).note;
            attributeService.createLabel(rules.noteId, "reasoningRule", "");

            await runReasoning();
            const inferred = task.getOwnedAttribute("label", "priority");
            expect(inferred?.value).toBe("high");
            expect(inferred).toBeTruthy();
            if (!inferred) {
                return;
            }
            expect(inferredAttributeIds(task.noteId)).toEqual([ inferred.attributeId ]);

            releaseInferred(inferred.attributeId);
            expect(inferredAttributeIds(task.noteId)).toEqual([]);

            const status = task.getOwnedAttribute("label", "status");
            expect(status).toBeTruthy();
            if (!status) {
                return;
            }
            status.value = "done";
            status.save();
            await runReasoning();
            expect(task.getOwnedAttributes("label", "priority")).toHaveLength(1);
            expect(task.getOwnedAttribute("label", "priority")?.value).toBe("high");
            expect(inferredAttributeIds(task.noteId)).toEqual([]);

            const other = noteService.createNewNote({
                parentNoteId: project.noteId,
                title: "Edited task",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(other.noteId, "status", "todo");
            await runReasoning();
            const created = other.getOwnedAttribute("label", "priority");
            expect(created?.value).toBe("high");
            if (!created) {
                return;
            }
            expect(inferredAttributeIds(other.noteId)).toEqual([ created.attributeId ]);
            created.value = "low";
            created.save();
            await runReasoning();

            const values = other.getOwnedAttributes("label", "priority").map((attribute) => attribute.value).sort();
            expect(values).toEqual([ "high", "low" ]);
            const kept = other.getOwnedAttributes("label", "priority").find((attribute) => attribute.value === "low");
            const fresh = other.getOwnedAttributes("label", "priority").find((attribute) => attribute.value === "high");
            expect(kept).toBeTruthy();
            expect(fresh).toBeTruthy();
            if (!kept || !fresh) {
                return;
            }
            expect(inferredAttributeIds(other.noteId)).toEqual([ fresh.attributeId ]);
            expect(inferredAttributeIds(other.noteId)).not.toContain(kept.attributeId);
        });
    });

    it("rechecks the edited note and leaves a distant conclusion in place", async () => {
        await getContext().init(async () => {
            noteService.createNewNote({
                parentNoteId: "root",
                title: "Mark rules",
                type: "code",
                mime: "text/plain",
                content: `#mark(?x, "yes") :- #status(?x, "todo").`,
                attributes: [{ type: "label", name: "reasoningRule", value: "" }]
            });
            const near = noteService.createNewNote({
                parentNoteId: "root",
                title: "Near todo",
                content: "",
                type: "text"
            }).note;
            const folder = noteService.createNewNote({
                parentNoteId: "root",
                title: "Far folder",
                content: "",
                type: "book"
            }).note;
            const mid = noteService.createNewNote({
                parentNoteId: folder.noteId,
                title: "Mid",
                content: "",
                type: "book"
            }).note;
            const far = noteService.createNewNote({
                parentNoteId: mid.noteId,
                title: "Far todo",
                content: "",
                type: "text"
            }).note;
            attributeService.createLabel(near.noteId, "status", "todo");
            attributeService.createLabel(far.noteId, "status", "todo");

            await runReasoning();
            expect(near.getOwnedAttribute("label", "mark")?.value).toBe("yes");
            expect(far.getOwnedAttribute("label", "mark")?.value).toBe("yes");

            const status = near.getOwnedAttribute("label", "status");
            expect(status).toBeTruthy();
            if (!status) {
                return;
            }
            status.value = "done";
            status.save();
            await runReasoningOn([{ noteId: near.noteId, kind: "label", name: "status" }]);

            expect(near.getOwnedAttribute("label", "mark")).toBeNull();
            expect(far.getOwnedAttribute("label", "mark")?.value).toBe("yes");
        });
    });

    it("lets a citation leave the workspace", async () => {
        await getContext().init(async () => {
            const parish = noteService.createNewNote({
                parentNoteId: "root",
                title: "Library",
                content: "",
                type: "book",
                attributes: [{ type: "label", name: "workspace", value: "" }]
            }).note;
            const book = noteService.createNewNote({
                parentNoteId: parish.noteId,
                title: "The book",
                content: "",
                type: "text"
            }).note;
            const essay = noteService.createNewNote({
                parentNoteId: "root",
                title: "Outside essay",
                content: "",
                type: "text"
            }).note;
            attributeService.createRelation(essay.noteId, "cites", book.noteId);
            noteService.createNewNote({
                parentNoteId: book.noteId,
                title: "Cite rules",
                type: "code",
                mime: "text/plain",
                content: `~listed(?citing, ?this) :- ~cites(?citing, ?this).`,
                attributes: [{ type: "label", name: "reasoningRule", value: "" }]
            });

            await runReasoning();
            expect(essay.getOwnedRelations("listed")[0]?.value).toBe(book.noteId);
        });
    });
});
