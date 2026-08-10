import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import { beforeEach, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import BAttribute from "../becca/entities/battribute.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import * as cls from "../services/context.js";
import { getSql } from "../services/sql/index.js";
import migration, {
    type BoardMigrationInput,
    BOARD_TEMPLATE_ID,
    deriveDefinitionAttributeId,
    parseBoardColumns,
    planBoardMigration,
    resolveStatusColumns
} from "./0240__migrate_board_status_to_select.js";

// Resolve the fixture relative to this spec. Spec files only ever run under vitest (ESM via Vite),
// so import.meta.url is available; the CLAUDE.md restriction applies to production code bundled to
// CJS, not to tests.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Migration 0240: board status becomes a select", () => {

    describe("resolveStatusColumns", () => {
        it("keeps the persisted order, appends what only the notes know, and drops blanks and repeats", () => {
            expect(resolveStatusColumns(
                [ "Todo", "Doing", " Done " ],
                [ "Doing", "Blocked", "", "   ", "Todo", "Archived" ]
            )).toEqual([ "Todo", "Doing", "Done", "Blocked", "Archived" ]);
        });

        it("treats columns differing only in case as distinct, as the board view does", () => {
            expect(resolveStatusColumns([ "todo" ], [ "Todo" ])).toEqual([ "todo", "Todo" ]);
        });

        it("returns nothing when there is nothing to offer", () => {
            expect(resolveStatusColumns([], [])).toEqual([]);
            expect(resolveStatusColumns([ "", "  " ], [ "" ])).toEqual([]);
        });
    });

    describe("parseBoardColumns", () => {
        it("reads the column values in order", () => {
            const content = JSON.stringify({ columns: [ { value: "Todo" }, { value: "Done" } ] });
            expect(parseBoardColumns(content)).toEqual([ "Todo", "Done" ]);
        });

        it("contributes nothing rather than throwing for content that is not a column list", () => {
            expect(parseBoardColumns("")).toEqual([]);
            expect(parseBoardColumns("   ")).toEqual([]);
            expect(parseBoardColumns("{ not json")).toEqual([]);
            expect(parseBoardColumns("null")).toEqual([]);
            expect(parseBoardColumns(JSON.stringify({}))).toEqual([]);
            expect(parseBoardColumns(JSON.stringify({ columns: "Todo" }))).toEqual([]);
        });

        it("skips entries that carry no string value", () => {
            const content = JSON.stringify({ columns: [ { value: "Todo" }, {}, null, { value: 7 }, { value: "Done" } ] });
            expect(parseBoardColumns(content)).toEqual([ "Todo", "Done" ]);
        });
    });

    describe("deriveDefinitionAttributeId", () => {
        it("is stable for a note, and different per note and per definition", () => {
            const id = deriveDefinitionAttributeId("boardNote1", "label:status");

            expect(id).toBe(deriveDefinitionAttributeId("boardNote1", "label:status"));
            expect(id).toHaveLength(12);
            expect(id).not.toBe(deriveDefinitionAttributeId("boardNote2", "label:status"));
            expect(id).not.toBe(deriveDefinitionAttributeId("boardNote1", "label:priority"));
        });
    });

    describe("planBoardMigration", () => {
        function input(overrides: Partial<BoardMigrationInput> = {}): BoardMigrationInput {
            return {
                noteId: "boardNote1",
                name: "status",
                isSystemNote: false,
                isProtected: false,
                isRelationMode: false,
                isSearchNote: false,
                persistedColumns: [ "Todo", "Done" ],
                discoveredValues: [],
                ...overrides
            };
        }

        function templateDefinition(value = "promoted,alias=Status,single,text") {
            return {
                attributeId: "_template_board_llabel:status",
                ownerNoteId: BOARD_TEMPLATE_ID,
                isInheritable: true,
                definition: promotedAttributeDefinitionParser.parse(value)
            };
        }

        it("copies the template's definition onto the board as a select, keeping alias and promotion", () => {
            const plan = planBoardMigration(input({ existingDefinition: templateDefinition() }));

            expect(plan).toMatchObject({
                action: "write",
                noteId: "boardNote1",
                name: "label:status",
                isInheritable: true,
                optionCount: 2,
                // Written under a derived id, not the template's.
                attributeId: deriveDefinitionAttributeId("boardNote1", "label:status")
            });

            const written = promotedAttributeDefinitionParser.parse(
                plan.action === "write" ? plan.value : "");
            expect(written).toEqual({
                isPromoted: true,
                promotedAlias: "Status",
                multiplicity: "single",
                labelType: "select",
                selectOptions: [ "Todo", "Done" ]
            });
        });

        it("does not make a field appear where the board never had a definition", () => {
            const plan = planBoardMigration(input());

            expect(plan.action).toBe("write");
            const written = promotedAttributeDefinitionParser.parse(
                plan.action === "write" ? plan.value : "");
            expect(written.isPromoted).toBeUndefined();
            expect(written.labelType).toBe("select");
            // Still inheritable, or it would not reach the notes on the board.
            expect(plan).toMatchObject({ isInheritable: true });
        });

        it("updates a definition the board already owns in place, reusing its id", () => {
            const plan = planBoardMigration(input({
                existingDefinition: {
                    attributeId: "ownedAttr1",
                    ownerNoteId: "boardNote1",
                    isInheritable: false,
                    definition: promotedAttributeDefinitionParser.parse("promoted,single,text")
                }
            }));

            expect(plan).toMatchObject({
                action: "write",
                attributeId: "ownedAttr1",
                isInheritable: false
            });
        });

        it("names the board's own group-by label rather than assuming status", () => {
            const plan = planBoardMigration(input({ name: "stage" }));
            expect(plan).toMatchObject({ action: "write", name: "label:stage" });
        });

        it("seeds the options from both the attachment and the notes", () => {
            const plan = planBoardMigration(input({
                persistedColumns: [ "Todo" ],
                discoveredValues: [ "Todo", "Blocked" ]
            }));

            expect(plan.action === "write" && promotedAttributeDefinitionParser.parse(plan.value).selectOptions)
                .toEqual([ "Todo", "Blocked" ]);
        });

        it.each([
            [ "system-note", { isSystemNote: true } ],
            [ "protected", { isProtected: true } ],
            [ "relation-mode", { isRelationMode: true } ],
            [ "search-note", { isSearchNote: true } ],
            [ "no-group-by", { name: "" } ],
            [ "no-columns", { persistedColumns: [], discoveredValues: [] } ]
        ])("leaves the board alone when it is %s", (reason, overrides) => {
            expect(planBoardMigration(input(overrides))).toEqual({ action: "skip", reason });
        });

        it.each([
            [ "already-select", "promoted,single,select,options=Todo;Done" ],
            [ "incompatible-type", "promoted,single,date" ],
            [ "multi-value", "promoted,multi,text" ]
        ])("leaves the board alone when the definition is %s", (reason, value) => {
            expect(planBoardMigration(input({ existingDefinition: templateDefinition(value) })))
                .toEqual({ action: "skip", reason });
        });

        it("leaves the board alone when the definition is owned beyond it", () => {
            expect(planBoardMigration(input({
                existingDefinition: { ...templateDefinition(), ownerNoteId: "someAncestor" }
            }))).toEqual({ action: "skip", reason: "foreign-definition" });
        });

        it("is checked in an order that never reads what a protected board would deny", () => {
            // Protection wins over everything else that would otherwise decide the outcome.
            expect(planBoardMigration(input({
                isProtected: true,
                persistedColumns: [],
                discoveredValues: [],
                existingDefinition: templateDefinition("promoted,single,select,options=A")
            }))).toEqual({ action: "skip", reason: "protected" });
        });
    });

    describe("running against a document", () => {
        let sql: ReturnType<typeof getSql>;

        beforeEach(async () => {
            // Resolved here rather than at describe-collection time so that initializeCore() in the
            // setup's beforeAll has run: describe callbacks fire before any beforeAll.
            sql = getSql();
            sql.rebuildFromBuffer(readFileSync(join(__dirname, "../test/fixtures/document.db")));

            await inContext(() => becca_loader.load());
        });

        it("gives a template-created board its own select definition, seeded from both sources", async () => {
            await inContext(() => {
                buildBoard({
                    noteId: "boardTemplated",
                    templateNoteId: BOARD_TEMPLATE_ID,
                    columns: [ "Todo", "In Progress" ],
                    children: [
                        { noteId: "cardA", status: "Todo" },
                        { noteId: "cardB", status: "Blocked" }
                    ]
                });
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                const definition = ownedDefinition("boardTemplated", "label:status");
                expect(definition).toBeTruthy();
                expect(definition?.isInheritable).toBe(true);
                expect(definition?.attributeId).toBe(deriveDefinitionAttributeId("boardTemplated", "label:status"));
                expect(definition?.getDefinition()).toEqual({
                    isPromoted: true,
                    promotedAlias: "Status",
                    multiplicity: "single",
                    labelType: "select",
                    // "Blocked" exists only on a note; "In Progress" only in the attachment.
                    selectOptions: [ "Todo", "In Progress", "Blocked" ]
                });

                // The attachment is left as it was, so an older client still reads its columns.
                expect(persistedColumnsOf("boardTemplated")).toEqual([ "Todo", "In Progress" ]);
            });
        });

        it("upgrades a definition the board already owns without adding a second one", async () => {
            await inContext(() => {
                const board = buildBoard({
                    noteId: "boardOwning",
                    columns: [ "Todo", "Done" ],
                    children: [ { noteId: "cardOwning", status: "Todo" } ]
                });
                board.addLabel("label:status", "promoted,alias=State,single,text", true);
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                const definitions = becca.getNoteOrThrow("boardOwning").getOwnedAttributes()
                    .filter((attr) => attr.name === "label:status");
                expect(definitions).toHaveLength(1);
                expect(definitions[0].getDefinition()).toEqual({
                    isPromoted: true,
                    promotedAlias: "State",
                    multiplicity: "single",
                    labelType: "select",
                    selectOptions: [ "Todo", "Done" ]
                });
                // Updated where it stood, rather than written under a derived id.
                expect(definitions[0].attributeId)
                    .not.toBe(deriveDefinitionAttributeId("boardOwning", "label:status"));
            });
        });

        it("contributes no columns when the attachment's content cannot be read", async () => {
            await inContext(() => {
                buildBoard({
                    noteId: "boardBrokenAttachment",
                    columns: [ "Todo", "Done" ],
                    children: [ { noteId: "cardBroken", status: "Doing" } ]
                });
            });

            // A board.json whose blob has gone missing throws on read; the values on the notes must
            // still get the board its columns.
            await inContext(() => {
                const attachment = becca.getNoteOrThrow("boardBrokenAttachment")
                    .getAttachmentsByRole("viewConfig")[0];
                sql.execute("DELETE FROM blobs WHERE blobId = ?", [ attachment.blobId ]);
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                expect(ownedDefinition("boardBrokenAttachment", "label:status")?.getDefinition().selectOptions)
                    .toEqual([ "Doing" ]);
            });
        });

        it("reads the values of grandchildren and archived notes, and honours #board:groupBy", async () => {
            await inContext(() => {
                const board = buildBoard({
                    noteId: "boardNested",
                    columns: [],
                    children: [
                        { noteId: "parentCard", status: "Doing", labelName: "stage" },
                        // A note that is on the board but has not been filed yet.
                        { noteId: "unfiledCard", status: "", labelName: "stage" }
                    ]
                });
                board.addLabel("board:groupBy", "#stage");

                const grandchild = buildNote("grandchildCard");
                new BBranch({ noteId: grandchild.noteId, parentNoteId: "parentCard" }).save();
                grandchild.addLabel("stage", "Shipped");

                const archived = buildNote("archivedCard");
                new BBranch({ noteId: archived.noteId, parentNoteId: "boardNested" }).save();
                archived.addLabel("stage", "Cancelled");
                archived.addLabel("archived");
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                const definition = ownedDefinition("boardNested", "label:stage");
                expect(definition?.getDefinition().selectOptions)
                    .toEqual([ "Doing", "Shipped", "Cancelled" ]);
                // The board had no definition of its own, so no field is introduced.
                expect(definition?.getDefinition().isPromoted).toBeUndefined();
            });
        });

        it("writes the same row when run twice, and leaves an already-migrated board untouched", async () => {
            await inContext(() => {
                buildBoard({
                    noteId: "boardTwice",
                    templateNoteId: BOARD_TEMPLATE_ID,
                    columns: [ "Todo" ],
                    children: [ { noteId: "cardTwice", status: "Todo" } ]
                });
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());
            const firstValue = await inContext(() => ownedDefinition("boardTwice", "label:status")?.value);

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                const definitions = becca.getNoteOrThrow("boardTwice").getOwnedAttributes()
                    .filter((attr) => attr.name === "label:status");
                expect(definitions).toHaveLength(1);
                expect(definitions[0].value).toBe(firstValue);
            });
        });

        it("leaves the board template, and every other note, without an options list of its own", async () => {
            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                const templateDefinition = becca.getNoteOrThrow(BOARD_TEMPLATE_ID)
                    .getOwnedAttributes()
                    .filter((attr) => attr.name === "label:status");
                expect(templateDefinition).toHaveLength(1);
                expect(templateDefinition[0].value).toBe("promoted,alias=Status,single,text");
            });
        });

        it.each([
            [ "protected", (board: BNote) => {
                // Flipping the flag through the entity would re-save the title encrypted, which
                // needs a data key; the column is where becca reads the flag from anyway.
                sql.execute("UPDATE notes SET isProtected = 1 WHERE noteId = ?", [ board.noteId ]);
            } ],
            [ "relation-mode", (board: BNote) => { board.addLabel("board:groupBy", "~status"); } ],
            [ "already a select", (board: BNote) => {
                board.addLabel("label:status", "promoted,single,select,options=Todo", true);
            } ],
            [ "typed as something else", (board: BNote) => {
                board.addLabel("label:status", "promoted,single,date", true);
            } ],
            [ "multi-valued", (board: BNote) => {
                board.addLabel("label:status", "promoted,multi,text", true);
            } ]
        ])("does not add a definition to a board that is %s", async (_name, configure) => {
            await inContext(() => {
                const board = buildBoard({
                    noteId: "boardSkipped",
                    columns: [ "Todo", "Done" ],
                    children: [ { noteId: "cardSkipped", status: "Todo" } ]
                });
                configure(board);
            });
            // Picks up anything the configuration wrote straight to the database.
            await inContext(() => becca_loader.load());

            const before = await inContext(() =>
                becca.getNoteOrThrow("boardSkipped").getOwnedAttributes()
                    .filter((attr) => attr.name === "label:status")
                    .map((attr) => attr.value));

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                expect(becca.getNoteOrThrow("boardSkipped").getOwnedAttributes()
                    .filter((attr) => attr.name === "label:status")
                    .map((attr) => attr.value)).toEqual(before);
            });
        });

        it("does not touch a board whose definition comes from an ancestor", async () => {
            await inContext(() => {
                const ancestor = buildNote("statusAncestor");
                new BBranch({ noteId: ancestor.noteId, parentNoteId: "root" }).save();
                ancestor.addLabel("label:status", "promoted,single,text", true);

                const board = buildBoard({
                    noteId: "boardBelowAncestor",
                    parentNoteId: "statusAncestor",
                    columns: [ "Todo" ],
                    children: [ { noteId: "cardBelowAncestor", status: "Todo" } ]
                });
                expect(board.getLabelValue("viewType")).toBe("board");
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                expect(ownedDefinition("boardBelowAncestor", "label:status")).toBeUndefined();
            });
        });

        it("does not touch notes that are not boards", async () => {
            await inContext(() => {
                const note = buildNote("plainNote");
                new BBranch({ noteId: note.noteId, parentNoteId: "root" }).save();
                note.addLabel("status", "Todo");
            });

            await inContext(() => migration());
            await inContext(() => becca_loader.load());

            await inContext(() => {
                expect(becca.getNoteOrThrow("plainNote").getOwnedAttributes()
                    .some((attr) => attr.isDefinition())).toBe(false);
            });
        });
    });
});

/** Runs `fn` inside a CLS context, which entity writes and becca loads both require. */
function inContext<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        cls.getContext().init(() => {
            try {
                resolve(fn());
            } catch (e) {
                reject(e);
            }
        });
    });
}

function buildNote(noteId: string, type: "text" | "book" | "search" = "text") {
    return new BNote({
        noteId,
        title: noteId,
        type,
        mime: type === "text" ? "text/html" : "",
        isProtected: false,
        blobId: ""
    }).save();
}

function buildBoard({ noteId, parentNoteId = "root", templateNoteId, columns, children = [] }: {
    noteId: string;
    parentNoteId?: string;
    templateNoteId?: string;
    columns: string[];
    children?: { noteId: string; status: string; labelName?: string }[];
}) {
    const board = buildNote(noteId, "book");
    new BBranch({ noteId, parentNoteId }).save();

    if (templateNoteId) {
        board.addRelation("template", templateNoteId);
    } else {
        board.addLabel("viewType", "board");
    }

    if (columns.length) {
        board.saveAttachment({
            role: "viewConfig",
            title: "board.json",
            mime: "application/json",
            content: JSON.stringify({ columns: columns.map((value) => ({ value })) }),
            position: 0
        });
    }

    for (const { noteId: childNoteId, status, labelName } of children) {
        const child = buildNote(childNoteId);
        new BBranch({ noteId: childNoteId, parentNoteId: noteId }).save();
        child.addLabel(labelName ?? "status", status);
    }

    return board;
}

function ownedDefinition(noteId: string, definitionName: string): BAttribute | undefined {
    return becca.getNoteOrThrow(noteId).getOwnedAttributes()
        .find((attr) => attr.name === definitionName);
}

function persistedColumnsOf(noteId: string): string[] {
    const attachment = becca.getNoteOrThrow(noteId).getAttachmentsByRole("viewConfig")
        .find((candidate) => candidate.title === "board.json");
    return attachment ? parseBoardColumns(attachment.getContent() as unknown as string) : [];
}
