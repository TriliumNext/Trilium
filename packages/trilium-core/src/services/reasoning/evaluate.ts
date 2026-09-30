import { attributeKeyword, type AttributeForm } from "./rule_program.js";

export interface ProjectedNote {
    noteId: string;
    title: string | null;
    type: string;
    labels: { name: string; value: string }[];
    relations: { name: string; targetNoteId: string }[];
    childIds: string[];
}

export interface InferenceQuery {
    form: AttributeForm;
    name: string;
    arity: 1 | 2;
    symbol: string;
    ruleNoteIds: string[];
    query: string;
}

export interface InferredFact {
    noteId: string;
    type: "label" | "relation";
    name: string;
    value: string;
    ruleNoteIds: string[];
}

export interface InferenceFailure {
    symbol: string;
    message: string;
}

interface DatascriptApi {
    create_conn: (schema?: Record<string, unknown>) => unknown;
    transact: (conn: unknown, tx: Record<string, unknown>[]) => unknown;
    db: (conn: unknown) => unknown;
    q: (query: string, db: unknown, rules?: string) => unknown;
}

/**
 * Drops child links that point at an ancestor. `descendant` is a recursive rule, and a clone cycle
 * would otherwise keep it running.
 */
export function dropBackEdges(childIdsByParent: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
    const state = new Map<string, "open" | "done">();
    const result = new Map<string, string[]>();

    const visit = (id: string) => {
        if (state.get(id) === "done") {
            return;
        }
        state.set(id, "open");
        const kept: string[] = [];
        for (const child of childIdsByParent.get(id) ?? []) {
            if (state.get(child) === "open") {
                continue;
            }
            kept.push(child);
            if (state.get(child) !== "done") {
                visit(child);
            }
        }
        result.set(id, kept);
        state.set(id, "done");
    };

    for (const id of childIdsByParent.keys()) {
        visit(id);
    }
    return result;
}

/** A label whose text is an integer or decimal is stored as a number so `?age > 18` can see it. */
export function storedLabelValue(value: string): string | number {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return value;
}

export async function inferFacts(graph: readonly ProjectedNote[], rulesEdn: string, queries: readonly InferenceQuery[]): Promise<{ facts: InferredFact[]; failures: InferenceFailure[] }> {
    if (queries.length === 0) {
        return { facts: [], failures: [] };
    }

    const datascript = await loadDatascript();
    const present = new Set(graph.map((note) => note.noteId));
    const schema: Record<string, unknown> = {
        "note/id": { ":db/unique": ":db.unique/identity" },
        "note/child": { ":db/valueType": ":db.type/ref", ":db/cardinality": ":db.cardinality/many" },
        "note/parent": { ":db/valueType": ":db.type/ref", ":db/cardinality": ":db.cardinality/many" }
    };
    const labelNames = new Set<string>();
    const relationNames = new Set<string>();
    for (const note of graph) {
        for (const label of note.labels) {
            labelNames.add(label.name);
        }
        for (const relation of note.relations) {
            relationNames.add(relation.name);
        }
    }
    for (const name of labelNames) {
        schema[attributeKeyword("label", name)] = { ":db/cardinality": ":db.cardinality/many" };
    }
    for (const name of relationNames) {
        schema[attributeKeyword("relation", name)] = {
            ":db/valueType": ":db.type/ref",
            ":db/cardinality": ":db.cardinality/many"
        };
    }

    const tempIds = new Map<string, number>();
    const tempId = (noteId: string) => {
        const existing = tempIds.get(noteId);
        if (existing !== undefined) {
            return existing;
        }
        const assigned = -(tempIds.size + 1);
        tempIds.set(noteId, assigned);
        return assigned;
    };

    const tx: Record<string, unknown>[] = [];
    for (const note of graph) {
        const entity: Record<string, unknown> = {
            ":db/id": tempId(note.noteId),
            "note/id": note.noteId,
            "note/type": note.type
        };
        if (note.title !== null) {
            entity["note/title"] = note.title;
        }
        const labels = new Map<string, (string | number)[]>();
        for (const label of note.labels) {
            const values = labels.get(label.name) ?? [];
            values.push(storedLabelValue(label.value));
            labels.set(label.name, values);
        }
        for (const [name, values] of labels) {
            entity[attributeKeyword("label", name)] = values.length === 1 ? values[0] : values;
        }
        const relations = new Map<string, number[]>();
        for (const relation of note.relations) {
            if (!present.has(relation.targetNoteId)) {
                continue;
            }
            const targets = relations.get(relation.name) ?? [];
            targets.push(tempId(relation.targetNoteId));
            relations.set(relation.name, targets);
        }
        for (const [name, targets] of relations) {
            entity[attributeKeyword("relation", name)] = targets.length === 1 ? targets[0] : targets;
        }
        const children = note.childIds.filter((id) => present.has(id)).map((id) => tempId(id));
        if (children.length === 1) {
            entity["note/child"] = children[0];
        } else if (children.length > 1) {
            entity["note/child"] = children;
        }
        tx.push(entity);
    }

    const parentLinks = new Map<number, number[]>();
    for (const note of graph) {
        for (const childId of note.childIds) {
            if (!present.has(childId)) {
                continue;
            }
            const parents = parentLinks.get(tempId(childId)) ?? [];
            parents.push(tempId(note.noteId));
            parentLinks.set(tempId(childId), parents);
        }
    }
    for (const entity of tx) {
        const id = entity[":db/id"];
        if (typeof id !== "number") {
            continue;
        }
        const parents = parentLinks.get(id);
        if (!parents || parents.length === 0) {
            continue;
        }
        entity["note/parent"] = parents.length === 1 ? parents[0] : parents;
    }

    const conn = datascript.create_conn(schema);
    datascript.transact(conn, tx);
    const db = datascript.db(conn);

    const facts: InferredFact[] = [];
    const failures: InferenceFailure[] = [];
    const seen = new Set<string>();

    for (const query of queries) {
        let rows: unknown;
        try {
            rows = datascript.q(query.query, db, rulesEdn);
        } catch (error) {
            failures.push({ symbol: query.symbol, message: errorText(error) });
            continue;
        }
        if (!Array.isArray(rows)) {
            failures.push({ symbol: query.symbol, message: "The query did not return rows." });
            continue;
        }
        for (const row of rows) {
            if (!Array.isArray(row)) {
                continue;
            }
            const fact = rowToFact(query, row, present);
            if (!fact) {
                continue;
            }
            const key = `${fact.noteId}\n${fact.type}\n${fact.name}\n${fact.value}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            facts.push(fact);
        }
    }

    return { facts, failures };
}

function rowToFact(query: InferenceQuery, row: unknown[], present: Set<string>): InferredFact | null {
    const noteId = asString(row[0]);
    if (!noteId || !present.has(noteId)) {
        return null;
    }
    if (query.form === "label" && query.arity === 1) {
        return { noteId, type: "label", name: query.name, value: "", ruleNoteIds: query.ruleNoteIds };
    }
    const value = asString(row[1]);
    if (value === null) {
        return null;
    }
    if (query.form === "relation" && !present.has(value)) {
        return null;
    }
    return { noteId, type: query.form, name: query.name, value, ruleNoteIds: query.ruleNoteIds };
}

function asString(value: unknown): string | null {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    return null;
}

function errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const line = message.split("\n")[0] ?? message;
    return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}

async function loadDatascript(): Promise<DatascriptApi> {
    const imported = await import("datascript");
    const module = imported as { default?: DatascriptApi };
    return module.default ?? (imported as unknown as DatascriptApi);
}
