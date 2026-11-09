import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { EntityChangeRef } from "../services/becca_replica_feed.js";
import * as cls from "../services/context.js";
import passwordEncryptionService from "../services/encryption/password_encryption.js";
import protectedSession from "../services/protected_session.js";
import SearchContext from "../services/search/search_context.js";
import searchService from "../services/search/services/search.js";
import { getSql } from "../services/sql/index.js";
import becca from "./becca.js";
import { applyEntityChanges } from "./becca_follower.js";
import { load } from "./becca_loader.js";

// Deriving the data key runs scrypt, which the standalone suite does in pure JS.
const isBrowserRuntime = typeof self !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 });
}

const TOKEN = "followertoken";
const ROOT = "flRoot";
const LABEL_NAMES = [ "fLabel1", "fLabel2", "fLabel3", "archived" ];
const RELATION_NAMES = [ "fRel", "fRel2" ];
const TEMPLATE_RELATION_NAMES = [ "template", "inherit" ];
const TEMPLATES = "flTemplates";
const VALUES = [ "", "v1", "v2", "v3" ];
const SEARCHES = [
    TOKEN,
    `${TOKEN} alpha`,
    "#fLabel1",
    "#fLabel2 = v3",
    "#fLabel3 *= v",
    "~fRel",
    "~template",
    `note.ancestors.noteId = ${ROOT}`,
    `note.parents.title *= ${TOKEN}`,
    `#fLabel1 and note.ancestors.title *= alpha`,
    `${TOKEN} orderBy note.title desc limit 15`
];

/**
 * Writes rows the way another process sharing the database would, and hands the entity changes to
 * `applyEntityChanges()` in batches, as commits.
 */
class RemoteWriter {
    // Shared by every writer, so that ids stay unique and timestamps keep rising across runs.
    private static tick = 0;
    private static counter = 0;
    private static position = 0;
    private pending: EntityChangeRef[] = [];
    private deferred: EntityChangeRef[] = [];

    constructor(readonly random: () => number, private dataKey: Uint8Array | null) {}

    now() {
        RemoteWriter.tick++;
        return new Date(Date.UTC(2031, 0, 1) + RemoteWriter.tick).toISOString().replace("T", " ");
    }

    nextId(prefix: string) {
        RemoteWriter.counter++;
        return `${prefix}${RemoteWriter.counter}`;
    }

    /** Random, so that a new or moved branch can sort before a note's existing parents. */
    nextPosition() {
        RemoteWriter.position++;
        return Math.floor(this.random() * 100000) * 1000 + (RemoteWriter.position % 1000);
    }

    pick<T>(items: T[]): T | undefined {
        return items.length ? items[Math.floor(this.random() * items.length)] : undefined;
    }

    change(entityName: string, entityId: string, { isErased = false, defer = false } = {}) {
        (defer ? this.deferred : this.pending).push({ entityName, entityId, isErased });
    }

    commit() {
        const changes = this.pending;
        this.pending = this.deferred;
        this.deferred = [];
        cls.init(() => applyEntityChanges(changes));
        warmIndexes();
    }

    flush() {
        this.commit();
        this.commit();
    }

    run(sql: string, params: unknown[] = []) {
        cls.init(() => getSql().execute(sql, params as never));
    }

    insertNote(noteId: string, title: string, { type = "text", isProtected = false, defer = false } = {}) {
        const now = this.now();
        const storedTitle = isProtected ? (protectedSession.encrypt(title) ?? title) : title;
        this.run(`INSERT INTO notes (noteId, title, isProtected, type, mime, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified)
                  VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [ noteId, storedTitle, isProtected ? 1 : 0, type, type === "code" ? "text/plain" : "text/html", now, now, now, now ]);
        this.change("notes", noteId, { defer });
    }

    insertBranch(branchId: string, noteId: string, parentNoteId: string, prefix: string | null = null) {
        this.run(`INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, prefix, isExpanded, isDeleted, utcDateModified)
                  VALUES (?, ?, ?, ?, ?, 0, 0, ?)`, [ branchId, noteId, parentNoteId, this.nextPosition(), prefix, this.now() ]);
        this.change("branches", branchId);
    }

    insertAttribute(noteId: string, type: string, name: string, value: string, isInheritable: boolean) {
        const attributeId = this.nextId("flA");
        this.run(`INSERT INTO attributes (attributeId, noteId, type, name, value, position, utcDateModified, isDeleted, isInheritable)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [ attributeId, noteId, type, name, value, this.nextPosition(), this.now(), isInheritable ? 1 : 0 ]);
        this.change("attributes", attributeId);
        return attributeId;
    }

    update(table: string, primaryKey: string, id: string, values: Record<string, unknown>) {
        const columns = Object.keys(values);
        this.run(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(", ")}, utcDateModified = ? WHERE ${primaryKey} = ?`,
            [ ...Object.values(values), this.now(), id ]);
        this.change(table, id);
    }

    /** The notes under {@link ROOT}, which every operation but a template relation works on. */
    liveNotes(): { noteId: string; isProtected: number }[] {
        return getSql().getRows("SELECT noteId, isProtected FROM notes WHERE isDeleted = 0 AND (noteId LIKE 'flN%' OR noteId = ?)", [ ROOT ]);
    }

    /**
     * The targets of template and inherit relations: notes outside {@link ROOT} that carry labels
     * only, so inheritance has no cycles. In a cycle the cached attributes depend on which note is
     * read first, so two correct beccas can disagree.
     */
    templateNotes(): string[] {
        return getSql().getColumn("SELECT noteId FROM notes WHERE isDeleted = 0 AND noteId LIKE 'flT%'");
    }

    createTemplates() {
        this.insertNote(TEMPLATES, `${TOKEN} templates`);
        this.insertBranch("flBtemplates", TEMPLATES, "root");
        for (let index = 0; index < 4; index++) {
            const noteId = this.nextId("flT");
            this.insertNote(noteId, this.title("template"));
            this.insertBranch(this.nextId("flB"), noteId, TEMPLATES);
            this.insertAttribute(noteId, "label", this.pick(LABEL_NAMES) ?? "fLabel1", this.pick(VALUES) ?? "", true);
        }
    }

    liveBranches(): { branchId: string; noteId: string; parentNoteId: string }[] {
        return getSql().getRows(`SELECT branchId, noteId, parentNoteId FROM branches
                                 WHERE isDeleted = 0 AND noteId LIKE 'flN%'`);
    }

    liveAttributes(): { attributeId: string; noteId: string; type: string; name: string }[] {
        return getSql().getRows("SELECT attributeId, noteId, type, name FROM attributes WHERE isDeleted = 0 AND attributeId LIKE 'flA%'");
    }

    subtree(noteId: string): Set<string> {
        return new Set(getSql().getColumn<string>(`
            WITH RECURSIVE sub(noteId) AS (
                SELECT ?
                UNION SELECT branches.noteId FROM branches JOIN sub ON branches.parentNoteId = sub.noteId
                WHERE branches.isDeleted = 0)
            SELECT noteId FROM sub`, [ noteId ]));
    }

    parentsOf(noteId: string): string[] {
        return getSql().getColumn("SELECT parentNoteId FROM branches WHERE isDeleted = 0 AND noteId = ?", [ noteId ]);
    }

    /** A note that can take `noteId` as a child without forming a cycle or a second branch. */
    newParentFor(noteId: string) {
        const excluded = this.subtree(noteId);
        for (const parentNoteId of this.parentsOf(noteId)) {
            excluded.add(parentNoteId);
        }
        return this.pick(this.liveNotes().map((note) => note.noteId).filter((id) => !excluded.has(id)));
    }

    title(word: string) {
        return `${TOKEN} ${word} ${this.nextId("t")}`;
    }

    createNote() {
        const parent = this.pick(this.liveNotes());
        if (!parent) {
            return;
        }

        const noteId = this.nextId("flN");
        const isProtected = !!this.dataKey && this.random() < 0.1;
        // The branch arrives one commit ahead of its note, which becca holds as a skeleton meanwhile.
        const defer = this.random() < 0.15;
        this.insertNote(noteId, this.title(this.pick([ "alpha", "beta", "gamma" ]) ?? "alpha"), {
            type: this.pick([ "text", "code", "book" ]), isProtected, defer
        });
        this.insertBranch(this.nextId("flB"), noteId, parent.noteId, this.random() < 0.2 ? `pre${RemoteWriter.counter}` : null);
    }

    randomStep() {
        const operations: (() => void)[] = [
            () => this.createNote(),
            () => this.createNote(),
            () => this.createNote(),
            () => {
                const note = this.pick(this.liveNotes().filter((n) => n.noteId !== ROOT));
                if (note) {
                    const title = this.title(this.pick([ "alpha", "delta" ]) ?? "delta");
                    this.update("notes", "noteId", note.noteId, {
                        title: note.isProtected ? (protectedSession.encrypt(title) ?? title) : title
                    });
                }
            },
            () => {
                const note = this.pick(this.liveNotes().filter((n) => n.noteId !== ROOT));
                if (note) {
                    this.update("notes", "noteId", note.noteId, { type: "code", mime: "application/json" });
                }
            },
            () => {
                const branch = this.pick(this.liveBranches());
                const target = branch && this.newParentFor(branch.noteId);
                if (branch && target) {
                    this.update("branches", "branchId", branch.branchId, { parentNoteId: target, notePosition: this.nextPosition() });
                }
            },
            () => {
                const note = this.pick(this.liveNotes().filter((n) => n.noteId !== ROOT));
                const target = note && this.newParentFor(note.noteId);
                if (note && target) {
                    this.insertBranch(this.nextId("flB"), note.noteId, target);
                }
            },
            () => {
                const branch = this.pick(this.liveBranches().filter((b) => this.parentsOf(b.noteId).length > 1));
                if (branch) {
                    this.update("branches", "branchId", branch.branchId, { isDeleted: 1 });
                }
            },
            () => this.deleteLeafNote(),
            () => this.eraseDeletedRow(),
            () => {
                const note = this.pick(this.liveNotes());
                if (note) {
                    this.insertAttribute(note.noteId, "label", this.pick(LABEL_NAMES) ?? "fLabel1",
                        this.pick(VALUES) ?? "", this.random() < 0.4);
                }
            },
            () => {
                const notes = this.liveNotes().map((n) => n.noteId);
                const owner = this.pick(notes);
                const target = this.pick(notes.filter((id) => id !== owner));
                if (owner && target) {
                    this.insertAttribute(owner, "relation", this.pick(RELATION_NAMES) ?? "fRel", target, this.random() < 0.3);
                }
            },
            () => {
                const owner = this.pick(this.liveNotes());
                const target = this.pick(this.templateNotes());
                if (owner && target) {
                    this.insertAttribute(owner.noteId, "relation", this.pick(TEMPLATE_RELATION_NAMES) ?? "template", target, false);
                }
            },
            () => {
                const owner = this.pick(this.templateNotes());
                if (owner) {
                    this.insertAttribute(owner, "label", this.pick(LABEL_NAMES) ?? "fLabel1", this.pick(VALUES) ?? "", this.random() < 0.5);
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                if (attribute) {
                    const names = attribute.type === "label"
                        ? LABEL_NAMES
                        : (TEMPLATE_RELATION_NAMES.includes(attribute.name) ? TEMPLATE_RELATION_NAMES : RELATION_NAMES);
                    this.update("attributes", "attributeId", attribute.attributeId, { name: this.pick(names) });
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                if (attribute?.type === "label") {
                    this.update("attributes", "attributeId", attribute.attributeId, { value: this.pick(VALUES) });
                } else if (attribute) {
                    const targets = TEMPLATE_RELATION_NAMES.includes(attribute.name) ? this.templateNotes() : this.liveNotes().map((n) => n.noteId);
                    const target = this.pick(targets.filter((id) => id !== attribute.noteId));
                    if (target) {
                        this.update("attributes", "attributeId", attribute.attributeId, { value: target });
                    }
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                if (attribute) {
                    this.run("UPDATE attributes SET isInheritable = 1 - isInheritable WHERE attributeId = ?", [ attribute.attributeId ]);
                    this.change("attributes", attribute.attributeId);
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                const target = this.pick(this.liveNotes().map((n) => n.noteId).filter((id) => id !== attribute?.noteId));
                if (attribute && target) {
                    this.update("attributes", "attributeId", attribute.attributeId, { noteId: target });
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                if (attribute) {
                    this.update("attributes", "attributeId", attribute.attributeId, { position: this.nextPosition() });
                }
            },
            () => {
                const attribute = this.pick(this.liveAttributes());
                if (attribute) {
                    this.update("attributes", "attributeId", attribute.attributeId, { isDeleted: 1 });
                }
            },
            () => this.reorderChildren(),
            () => {
                const branch = this.pick(this.liveBranches());
                if (branch) {
                    this.update("branches", "branchId", branch.branchId, { prefix: this.random() < 0.5 ? null : `pfx ${RemoteWriter.counter}` });
                }
            },
            () => {
                const name = `flOption${Math.floor(this.random() * 3)}`;
                this.run("INSERT OR REPLACE INTO options (name, value, isSynced, utcDateModified) VALUES (?, ?, 0, ?)",
                    [ name, `value${RemoteWriter.counter++}`, this.now() ]);
                this.change("options", name);
            }
        ];

        operations[Math.floor(this.random() * operations.length)]();
    }

    deleteLeafNote() {
        const note = this.pick(this.liveNotes().filter((n) => n.noteId !== ROOT && this.subtree(n.noteId).size === 1));
        if (!note) {
            return;
        }

        const { noteId } = note;
        this.update("notes", "noteId", noteId, { isDeleted: 1 });
        for (const branchId of getSql().getColumn<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND noteId = ?", [ noteId ])) {
            this.update("branches", "branchId", branchId, { isDeleted: 1 });
        }
        const attributeIds = getSql().getColumn<string>(`SELECT attributeId FROM attributes WHERE isDeleted = 0
            AND (noteId = ? OR (type = 'relation' AND value = ?))`, [ noteId, noteId ]);
        for (const attributeId of attributeIds) {
            this.update("attributes", "attributeId", attributeId, { isDeleted: 1 });
        }
    }

    eraseDeletedRow() {
        const tables: [ string, string ][] = [ [ "notes", "noteId" ], [ "branches", "branchId" ], [ "attributes", "attributeId" ] ];
        const [ table, primaryKey ] = this.pick(tables) ?? tables[0];
        const id = this.pick(getSql().getColumn<string>(`SELECT ${primaryKey} FROM ${table} WHERE isDeleted = 1 AND ${primaryKey} LIKE 'fl%'`));
        if (id) {
            this.run(`DELETE FROM ${table} WHERE ${primaryKey} = ?`, [ id ]);
            this.change(table, id, { isErased: true });
        }
    }

    reorderChildren() {
        const parent = this.pick(this.liveNotes().filter((n) =>
            getSql().getValue<number>("SELECT COUNT(*) FROM branches WHERE isDeleted = 0 AND parentNoteId = ?", [ n.noteId ]) > 1));
        if (!parent) {
            return;
        }

        const branchIds = getSql().getColumn<string>("SELECT branchId FROM branches WHERE isDeleted = 0 AND parentNoteId = ?", [ parent.noteId ]);
        branchIds.sort(() => this.random() - 0.5);
        for (const branchId of branchIds) {
            this.run("UPDATE branches SET notePosition = ? WHERE branchId = ?", [ this.nextPosition(), branchId ]);
        }
        this.change("note_reordering", parent.noteId);
    }
}

describe("becca follower", () => {
    let dataKey: Uint8Array | null = null;

    beforeAll(async () => {
        const key = await passwordEncryptionService.getDataKey("demo1234");
        dataKey = key || null;
        if (dataKey) {
            protectedSession.setDataKey(dataKey);
            becca.decryptProtectedNotes();
        }
    });

    afterAll(() => {
        protectedSession.resetDataKey();
    });

    it("keeps becca identical to a fresh load through a seeded run of changes", () => {
        for (const seed of [ 11, 23, 37 ]) {
            const writer = new RemoteWriter(mulberry32(seed), dataKey);
            if (seed === 11) {
                writer.insertNote(ROOT, `${TOKEN} root`);
                writer.insertBranch("flBroot", ROOT, "root");
                writer.createTemplates();
                writer.commit();
            }

            // Short windows, each checked against a load: a missed invalidation shows up before a
            // later change that invalidates widely can hide it.
            for (let window = 0; window < 20; window++) {
                warmCaches();
                for (let step = 0; step < 20; step++) {
                    writer.randomStep();
                    if (writer.random() < 0.35) {
                        writer.commit();
                    }
                }
                writer.flush();

                const followed = describeBecca();
                const followedSearches = runSearches();

                cls.init(() => load());

                expect(followed, `seed ${seed}, window ${window}`).toEqual(describeBecca());
                expect(followedSearches, `seed ${seed}, window ${window}`).toEqual(runSearches());
            }
        }

        const count = (query: string) => getSql().getValue<number>(query);
        expect(dataKey).not.toBeNull();
        expect(count("SELECT COUNT(*) FROM notes WHERE isProtected = 1 AND isDeleted = 0 AND noteId LIKE 'flN%'")).toBeGreaterThan(0);
        expect(count("SELECT COUNT(*) FROM branches WHERE isDeleted = 0 AND noteId LIKE 'flN%'"))
            .toBeGreaterThan(count("SELECT COUNT(*) FROM notes WHERE isDeleted = 0 AND noteId LIKE 'flN%'"));
        expect(count("SELECT COUNT(*) FROM attributes WHERE isDeleted = 0 AND name IN ('template', 'inherit')")).toBeGreaterThan(0);
    });

    it("re-indexes attributes and re-links branches whose identity changed in place", () => {
        const writer = new RemoteWriter(mulberry32(5), dataKey);
        warmCaches();

        const parentA = writer.nextId("flN");
        const parentB = writer.nextId("flN");
        const child = writer.nextId("flN");
        writer.insertNote(parentA, writer.title("alpha"));
        writer.insertBranch(writer.nextId("flB"), parentA, ROOT);
        writer.insertNote(parentB, writer.title("beta"));
        writer.insertBranch(writer.nextId("flB"), parentB, ROOT);
        writer.insertNote(child, writer.title("gamma"));
        const childBranch = writer.nextId("flB");
        writer.insertBranch(childBranch, child, parentA);
        const label = writer.insertAttribute(child, "label", "fLabel1", "v1", false);
        const relation = writer.insertAttribute(child, "relation", "fRel", parentA, false);
        writer.commit();

        writer.update("branches", "branchId", childBranch, { parentNoteId: parentB });
        writer.update("attributes", "attributeId", label, { name: "fLabel2" });
        writer.update("attributes", "attributeId", relation, { value: parentB });
        writer.commit();

        const childNote = becca.getNoteOrThrow(child);
        expect(childNote.getParentNotes().map((note) => note.noteId)).toEqual([ parentB ]);
        expect(becca.getNoteOrThrow(parentA).children).not.toContain(childNote);
        expect(becca.getNoteOrThrow(parentB).children).toContain(childNote);
        expect(becca.childParentToBranch[`${child}-${parentA}`]).toBeUndefined();
        expect([ ...(becca.attributeIndex["label-flabel1"] ?? []) ].map((a) => a.attributeId)).not.toContain(label);
        expect([ ...(becca.attributeIndex["label-flabel2"] ?? []) ].map((a) => a.attributeId)).toContain(label);
        expect(becca.getNoteOrThrow(parentA).targetRelations.map((a) => a.attributeId)).not.toContain(relation);
        expect(becca.getNoteOrThrow(parentB).targetRelations.map((a) => a.attributeId)).toContain(relation);

        // A parent that becomes archived, directly or through a template, can rank differently.
        const templateNote = writer.nextId("flT");
        writer.insertNote(templateNote, writer.title("template"));
        writer.insertBranch(writer.nextId("flB"), templateNote, TEMPLATES);
        writer.insertAttribute(templateNote, "label", "archived", "", false);
        writer.insertBranch(writer.nextId("flB"), child, parentA);
        writer.commit();
        expectMatchesLoad();

        const archived = writer.insertAttribute(parentA, "label", "archived", "", false);
        writer.commit();
        expectMatchesLoad();

        writer.update("attributes", "attributeId", archived, { isDeleted: 1 });
        writer.insertAttribute(parentB, "relation", "template", templateNote, false);
        writer.commit();
        expectMatchesLoad();

        writer.change("note_reordering", "flNoSuchParent");
        writer.change("revisions", "flNoSuchRevision");
        writer.change("blobs", "flNoSuchBlob");
        writer.change("etapi_tokens", "flNoSuchToken");
        writer.change("options", "flNoSuchOption");
        writer.commit();

        expectMatchesLoad();
    });

    it("refreshes the built search index for a renamed note, a moved label and a new prefix", () => {
        const writer = new RemoteWriter(mulberry32(7), dataKey);
        const noteId = writer.nextId("flN");
        const branchId = writer.nextId("flB");
        writer.insertNote(noteId, writer.title("alpha"));
        writer.insertBranch(branchId, noteId, ROOT);
        const label = writer.insertAttribute(ROOT, "label", "fLabel3", "", true);
        writer.commit();
        warmCaches();

        const find = (query: string) => cls.init(() => searchService
            .findResultsWithQuery(query, new SearchContext({ fastSearch: true, ignoreHoistedNote: true }))
            .map((result) => result.noteId));

        writer.update("notes", "noteId", noteId, { title: `${TOKEN} zzrenamed` });
        writer.commit();
        expect(find("zzrenamed")).toEqual([ noteId ]);

        writer.update("branches", "branchId", branchId, { prefix: "zzprefix" });
        writer.commit();
        expect(find("zzprefix")).toEqual([ noteId ]);

        writer.update("attributes", "attributeId", label, { value: "zzinherited" });
        writer.commit();
        expect(find("#fLabel3 = zzinherited")).toContain(noteId);

        expectMatchesLoad();
    });

    it("leaves becca alone before it is loaded and for an empty batch", () => {
        const before = Object.keys(becca.notes).length;
        applyEntityChanges([]);
        becca.loaded = false;
        try {
            applyEntityChanges([ { entityName: "notes", entityId: "root", isErased: false } ]);
        } finally {
            becca.loaded = true;
        }
        expect(Object.keys(becca.notes)).toHaveLength(before);
    });
});

/** Compares becca with what a load builds from the same rows, and leaves the loaded becca in place. */
function expectMatchesLoad() {
    const followed = describeBecca();
    const followedSearches = runSearches();
    cls.init(() => load());
    expect(followed).toEqual(describeBecca());
    expect(followedSearches).toEqual(runSearches());
    warmCaches();
}

/** Builds the caches a long-running process holds, so stale ones show up in the comparison. */
function warmCaches() {
    warmIndexes();
    runSearches();
}

/** The caches that can be built while a skeleton note waits for its row, which a search cannot. */
function warmIndexes() {
    becca.getFlatTextIndex();
    for (const note of Object.values(becca.notes)) {
        note.getFlatText();
        note.getAttributes();
    }
}

function runSearches() {
    return cls.init(() => SEARCHES.flatMap((query) => [ false, true ].map((includeArchivedNotes) => {
        const context = new SearchContext({ fastSearch: true, includeArchivedNotes, ignoreHoistedNote: true });
        return {
            query,
            includeArchivedNotes,
            results: searchService.findResultsWithQuery(query, context).map((result) => result.notePath)
        };
    })));
}

/**
 * Everything a search can read from becca, in a form two beccas can be compared by. Owned
 * attributes, parents and children keep their order, which a load fixes; target relations do not.
 */
function describeBecca() {
    const notes = Object.keys(becca.notes).sort().map((noteId) => {
        const note = becca.notes[noteId];
        return {
            noteId,
            title: note.title,
            type: note.type,
            mime: note.mime,
            isProtected: note.isProtected,
            isDecrypted: note.isDecrypted,
            parentBranches: note.parentBranches.map((branch) => branch.branchId),
            parents: note.parents.map((parent) => parent.noteId),
            children: note.children.map((child) => child.noteId),
            ownedAttributes: note.ownedAttributes.map((attribute) => attribute.attributeId),
            attributes: note.getAttributes().map((attribute) => attribute.attributeId),
            targetRelations: note.targetRelations.map((attribute) => attribute.attributeId).sort(),
            flatText: note.getFlatText(),
            isArchived: note.isArchived
        };
    });

    const flatTextIndex = becca.getFlatTextIndex();

    return {
        notes,
        branches: Object.keys(becca.branches).sort().map((branchId) => {
            const { noteId, parentNoteId, prefix, notePosition, isExpanded } = becca.branches[branchId];
            return { branchId, noteId, parentNoteId, prefix, notePosition, isExpanded };
        }),
        childParentToBranch: Object.keys(becca.childParentToBranch).sort()
            .map((key) => [ key, becca.childParentToBranch[key].branchId ]),
        attributes: Object.keys(becca.attributes).sort().map((attributeId) => {
            const { noteId, type, name, value, isInheritable, position } = becca.attributes[attributeId];
            return { attributeId, noteId, type, name, value, isInheritable, position };
        }),
        attributeIndex: Object.keys(becca.attributeIndex).sort()
            .filter((key) => becca.attributeIndex[key].size > 0)
            .map((key) => [ key, [ ...becca.attributeIndex[key] ].map((attribute) => attribute.attributeId).sort() ]),
        options: Object.keys(becca.options).sort().map((name) => [ name, becca.options[name].value ]),
        etapiTokens: Object.keys(becca.etapiTokens).sort(),
        noteSet: becca.getAllNoteSet().notes.map((note) => note.noteId).sort(),
        flatTextIndex: flatTextIndex.notes
            .map((note, index) => [ note.noteId, flatTextIndex.flatTexts[index] ])
            .sort(([ a ], [ b ]) => (a < b ? -1 : a > b ? 1 : 0))
    };
}

function mulberry32(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
