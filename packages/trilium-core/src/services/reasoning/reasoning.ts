import { t } from "i18next";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import attributeService from "../attributes.js";
import { getContext } from "../context.js";
import eventService from "../events.js";
import { getLog } from "../log.js";
import noteService from "../notes.js";
import oneTimeTimer from "../one_time_timer.js";
import sqlInit from "../sql_init.js";
import { unwrapStringOrBuffer } from "../utils/binary.js";
import {
    dropBackEdges,
    inferFacts,
    type InferenceQuery,
    type InferredFact,
    type ProjectedNote
} from "./evaluate.js";
import {
    assembleRules,
    compileRuleNote,
    type IdbPredicate,
    predicateKey,
    queryFor,
    type ResolvedScope,
    type RuleDiagnostic,
    resolveScope,
    type ScopeFacts
} from "./rule_program.js";

const PROVENANCE_NOTE_ID = "_reasoningProvenance";

const RESERVED_ATTRIBUTES = new Set([
    "reasoningRule",
    "reasoningError",
    "reasoningScope",
    "reasoningSchema"
]);

export interface ReasoningReport {
    ruleNotes: number;
    inferred: number;
    retracted: number;
    errors: { noteId: string; message: string }[];
}

interface StoredFact {
    attributeId: string;
    noteId: string;
    type: "label" | "relation";
    name: string;
    value: string;
}

let started = false;
let running = false;
let rerun = false;
let armed = false;
let chain: Promise<ReasoningReport> | null = null;
let lastReport: ReasoningReport = { ruleNotes: 0, inferred: 0, retracted: 0, errors: [] };

export function getReasoningReport(): ReasoningReport {
    return lastReport;
}

/** Attribute ids on `noteId` that the reasoner still owns. A hand-edited value is no longer owned. */
export function inferredAttributeIds(noteId: string): string[] {
    const note = becca.notes[PROVENANCE_NOTE_ID];
    if (!note || note.isDeleted) {
        return [];
    }
    const ids: string[] = [];
    for (const fact of readProvenance(note)) {
        if (fact.noteId === noteId && factStillOwned(fact)) {
            ids.push(fact.attributeId);
        }
    }
    return ids;
}

/** The attribute stays. The reasoner stops creating, changing, and deleting it. */
export function releaseInferred(attributeId: string) {
    const note = becca.notes[PROVENANCE_NOTE_ID];
    if (!note || note.isDeleted) {
        return;
    }
    const facts = readProvenance(note).filter((fact) => fact.attributeId !== attributeId);
    writeProvenance(facts);
}

export function startReasoningEngine() {
    if (started) {
        return;
    }
    started = true;

    eventService.subscribe(
        [
            eventService.ENTITY_CREATED,
            eventService.ENTITY_CHANGED,
            eventService.ENTITY_DELETED,
            eventService.NOTE_CONTENT_CHANGE,
            eventService.NOTE_TITLE_CHANGED
        ],
        (payload) => {
            if (running) {
                rerun = true;
                return;
            }
            if (!armed && !eventArms(payload)) {
                return;
            }
            scheduleReasoning();
        }
    );

    sqlInit.dbReady.then(() => {
        oneTimeTimer.scheduleExecution("reasoning-startup", 1000, () => {
            void runReasoning();
        });
    });
}

export function runReasoning(): Promise<ReasoningReport> {
    if (chain) {
        return chain;
    }
    chain = getContext().init(() => execute()).finally(() => {
        chain = null;
        if (rerun) {
            rerun = false;
            scheduleReasoning();
        }
    });
    return chain;
}

async function execute(): Promise<ReasoningReport> {
    running = true;
    try {
        lastReport = await executeOnce();
        return lastReport;
    } catch (error) {
        getLog().error(`Reasoning failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        lastReport = { ruleNotes: 0, inferred: 0, retracted: 0, errors: [] };
        return lastReport;
    } finally {
        running = false;
    }
}

async function executeOnce(): Promise<ReasoningReport> {
    const ruleNotes = collectRuleNotes();
    const provenanceNote = becca.notes[PROVENANCE_NOTE_ID];
    const stored = provenanceNote ? readProvenance(provenanceNote) : [];

    if (ruleNotes.length === 0 && stored.length === 0) {
        armed = false;
        return { ruleNotes: 0, inferred: 0, retracted: 0, errors: [] };
    }

    armed = true;
    const messages = new Map<string, string[]>();
    const ruleIds = new Set(ruleNotes.map((note) => note.noteId));
    const inferredIds = new Set(stored.map((fact) => fact.attributeId));
    const graph = projectGraph(ruleIds, inferredIds);
    const titles = new Map<string, string[]>();
    for (const note of graph) {
        if (note.title === null) {
            continue;
        }
        const list = titles.get(note.title) ?? [];
        list.push(note.noteId);
        titles.set(note.title, list);
    }

    const idb = new Map<string, IdbPredicate>();
    const definers = new Map<string, string[]>();
    const compiled = new Map<string, ReturnType<typeof compileRuleNote>>();
    const scopes = new Map<string, ResolvedScope>();

    for (const note of ruleNotes) {
        const source = readRuleSource(note);
        if (source === null) {
            messages.set(note.noteId, [t("reasoning.protected")]);
            continue;
        }
        const resolved = resolveScope(scopeFacts(note));
        scopes.set(note.noteId, resolved);
        if (!resolved.ok) {
            messages.set(note.noteId, [describeDiagnostic(resolved.diagnostic)]);
            continue;
        }
        const first = compileRuleNote(source, resolved.scope, titles, idb);
        compiled.set(note.noteId, first);
        for (const clause of first.clauses) {
            const key = predicateKey(clause.form, clause.arity, clause.name);
            if (!idb.has(key)) {
                idb.set(key, { symbol: clause.symbol, arity: clause.arity, form: clause.form, name: clause.name });
            }
            const owners = definers.get(key) ?? [];
            if (!owners.includes(note.noteId)) {
                owners.push(note.noteId);
            }
            definers.set(key, owners);
        }
    }

    const clauseEdn: string[] = [];
    const queries: InferenceQuery[] = [];
    const seenSymbols = new Set<string>();

    for (const note of ruleNotes) {
        const resolved = scopes.get(note.noteId);
        if (!resolved?.ok) {
            continue;
        }
        const source = readRuleSource(note);
        if (source === null) {
            continue;
        }
        const second = compileRuleNote(source, resolved.scope, titles, idb);
        compiled.set(note.noteId, second);
        for (const clause of second.clauses) {
            clauseEdn.push(clause.edn);
            if (seenSymbols.has(clause.symbol)) {
                continue;
            }
            seenSymbols.add(clause.symbol);
            const key = predicateKey(clause.form, clause.arity, clause.name);
            queries.push({
                form: clause.form,
                name: clause.name,
                arity: clause.arity,
                symbol: clause.symbol,
                ruleNoteIds: definers.get(key) ?? [note.noteId],
                query: queryFor(clause.form, clause.arity, clause.symbol)
            });
        }
    }

    for (const note of ruleNotes) {
        const result = compiled.get(note.noteId);
        if (!result) {
            continue;
        }
        const text = result.diagnostics.map(describeDiagnostic);
        if (text.length > 0) {
            messages.set(note.noteId, text);
        }
    }

    const rulesEdn = assembleRules(clauseEdn);
    const inferred = queries.length === 0
        ? { facts: [] as InferredFact[], failures: [] as { symbol: string; message: string }[] }
        : await inferFacts(graph, rulesEdn, queries);

    for (const failure of inferred.failures) {
        const query = queries.find((candidate) => candidate.symbol === failure.symbol);
        for (const noteId of query?.ruleNoteIds ?? []) {
            const list = messages.get(noteId) ?? [];
            list.push(t("reasoning.engine", { detail: failure.message }));
            messages.set(noteId, list);
        }
    }

    for (const note of ruleNotes) {
        const list = messages.get(note.noteId);
        setRuleError(note, list && list.length > 0 ? list.join(" | ") : null);
    }

    const applied = applyFacts(inferred.facts, stored);
    const released = releasedSince(stored);
    const next = released.size === 0
        ? applied.next
        : applied.next.filter((fact) => !released.has(fact.attributeId));
    writeProvenance(next);

    return {
        ruleNotes: ruleNotes.length,
        inferred: applied.next.length,
        retracted: applied.retracted,
        errors: [...messages.entries()].map(([noteId, list]) => ({ noteId, message: list.join(" | ") }))
    };
}

function collectRuleNotes(): BNote[] {
    const owners: BNote[] = [];
    for (const attr of becca.findAttributes("label", "reasoningRule")) {
        const owner = becca.notes[attr.noteId];
        if (owner && !owner.isDeleted) {
            owners.push(owner);
        }
    }

    const ownerIds = new Set(owners.map((note) => note.noteId));
    const notes = new Map<string, BNote>();
    for (const owner of owners) {
        if (!owner.noteId.startsWith("_") && owner.isContentAvailable()) {
            notes.set(owner.noteId, owner);
        }
    }
    for (const rel of becca.findAttributes("relation", "template")) {
        if (!ownerIds.has(rel.value)) {
            continue;
        }
        const instance = becca.notes[rel.noteId];
        if (!instance || instance.isDeleted || instance.noteId.startsWith("_") || !instance.isContentAvailable()) {
            continue;
        }
        if (instance.type !== "code" && instance.type !== "text") {
            continue;
        }
        notes.set(instance.noteId, instance);
    }
    return [...notes.values()];
}

function scopeFacts(note: BNote): ScopeFacts {
    const branches = note.getStrongParentBranches().slice().sort((a, b) => (a.notePosition ?? 0) - (b.notePosition ?? 0));
    let parent: BNote | null = null;
    for (const branch of branches) {
        const candidate = becca.notes[branch.parentNoteId];
        if (!candidate || candidate.isDeleted || candidate.noteId === "root" || candidate.noteId.startsWith("_")) {
            continue;
        }
        parent = candidate;
        break;
    }

    const owns = (target: BNote | null, name: string) => !!target?.getOwnedAttribute("label", name);
    const scopeLabel = note.getOwnedAttribute("label", "reasoningScope");
    return {
        ruleNoteId: note.noteId,
        parentId: parent?.noteId ?? null,
        parentIsTemplate: owns(parent, "template"),
        parentIsSchema: owns(parent, "reasoningSchema"),
        selfIsTemplate: owns(note, "template"),
        selfIsSchema: owns(note, "reasoningSchema"),
        wantsGlobal: scopeLabel?.value === "global"
    };
}

function projectGraph(ruleIds: ReadonlySet<string>, inferredIds: ReadonlySet<string>): ProjectedNote[] {
    const included: BNote[] = [];
    for (const note of Object.values(becca.notes)) {
        if (!note || note.isDeleted || note.noteId.startsWith("_")) {
            continue;
        }
        included.push(note);
    }

    const includedIds = new Set(included.map((note) => note.noteId));
    const rawChildren = new Map<string, string[]>();
    for (const note of included) {
        if (ruleIds.has(note.noteId)) {
            continue;
        }
        for (const branch of note.getStrongParentBranches()) {
            if (!includedIds.has(branch.parentNoteId)) {
                continue;
            }
            const list = rawChildren.get(branch.parentNoteId) ?? [];
            list.push(note.noteId);
            rawChildren.set(branch.parentNoteId, list);
        }
    }
    const children = dropBackEdges(rawChildren);

    const projected: ProjectedNote[] = [];
    for (const note of included) {
        const labels: ProjectedNote["labels"] = [];
        const relations: ProjectedNote["relations"] = [];
        for (const attr of note.getOwnedAttributes()) {
            if (inferredIds.has(attr.attributeId) || RESERVED_ATTRIBUTES.has(attr.name) || attr.isAutoLink()) {
                continue;
            }
            if (attr.isDefinition() || attr.name.startsWith("child:")) {
                continue;
            }
            if (attr.type === "label") {
                labels.push({ name: attr.name, value: attr.value });
            } else if (attr.type === "relation" && attr.value && includedIds.has(attr.value)) {
                relations.push({ name: attr.name, targetNoteId: attr.value });
            }
        }
        projected.push({
            noteId: note.noteId,
            title: note.isContentAvailable() ? note.title : null,
            type: note.type,
            labels,
            relations,
            childIds: children.get(note.noteId) ?? []
        });
    }
    return projected;
}

function readRuleSource(note: BNote): string | null {
    if (!note.isContentAvailable()) {
        return null;
    }
    const content = unwrapStringOrBuffer(note.getContent());
    if (typeof content !== "string") {
        return null;
    }
    if (note.type === "text") {
        return htmlToPlain(content);
    }
    return content;
}

function applyFacts(desired: readonly InferredFact[], stored: readonly StoredFact[]): { retracted: number; next: StoredFact[] } {
    const desiredByKey = new Map<string, InferredFact>();
    for (const fact of desired) {
        desiredByKey.set(factKey(fact), fact);
    }

    const storedByKey = new Map<string, StoredFact>();
    const storedIds = new Set<string>();
    for (const fact of stored) {
        // Gone, so the rule may write it again. Changed by hand, so it is now a normal attribute.
        if (!factStillOwned(fact)) {
            continue;
        }
        storedByKey.set(factKey(fact), fact);
        storedIds.add(fact.attributeId);
    }

    const manual = new Set<string>();
    for (const attr of Object.values(becca.attributes)) {
        if (storedIds.has(attr.attributeId)) {
            continue;
        }
        manual.add(factKey(attr));
    }

    let retracted = 0;
    for (const [key, fact] of storedByKey) {
        if (desiredByKey.has(key)) {
            continue;
        }
        const attr = becca.attributes[fact.attributeId];
        if (!attr) {
            continue;
        }
        attr.markAsDeleted();
        retracted += 1;
    }

    const next: StoredFact[] = [];
    for (const [key, fact] of desiredByKey) {
        if (manual.has(key)) {
            continue;
        }
        const existing = storedByKey.get(key);
        if (existing && becca.attributes[existing.attributeId]) {
            next.push(existing);
            continue;
        }
        const note = becca.notes[fact.noteId];
        if (!note || note.isDeleted) {
            continue;
        }
        if (fact.type === "relation") {
            if (!becca.notes[fact.value]) {
                continue;
            }
            const created = attributeService.createRelation(fact.noteId, fact.name, fact.value);
            next.push({ attributeId: created.attributeId, noteId: fact.noteId, type: "relation", name: fact.name, value: fact.value });
        } else {
            const created = attributeService.createLabel(fact.noteId, fact.name, fact.value);
            next.push({ attributeId: created.attributeId, noteId: fact.noteId, type: "label", name: fact.name, value: fact.value });
        }
    }
    return { retracted, next };
}

function readProvenance(note: BNote): StoredFact[] {
    if (!note.isContentAvailable()) {
        return [];
    }
    try {
        const content = unwrapStringOrBuffer(note.getContent());
        if (typeof content !== "string" || !content.trim()) {
            return [];
        }
        const parsed: unknown = JSON.parse(content);
        if (!parsed || typeof parsed !== "object" || !("facts" in parsed) || !Array.isArray(parsed.facts)) {
            return [];
        }
        const facts: StoredFact[] = [];
        for (const entry of parsed.facts) {
            if (!isStoredFact(entry)) {
                continue;
            }
            facts.push(entry);
        }
        return facts;
    } catch {
        return [];
    }
}

function writeProvenance(facts: readonly StoredFact[]) {
    const note = ensureProvenanceNote();
    if (!note) {
        return;
    }
    const content = JSON.stringify({ facts });
    if (note.isContentAvailable() && unwrapStringOrBuffer(note.getContent()) === content) {
        return;
    }
    note.setContent(content);
}

function ensureProvenanceNote(): BNote | null {
    const existing = becca.notes[PROVENANCE_NOTE_ID];
    if (existing && !existing.isDeleted) {
        return existing;
    }
    if (!becca.notes["_hidden"]) {
        return null;
    }
    return noteService.createNewNote({
        noteId: PROVENANCE_NOTE_ID,
        parentNoteId: "_hidden",
        title: t("hidden-subtree.reasoning-provenance-title"),
        type: "code",
        mime: "application/json",
        content: "{\"facts\":[]}",
        ignoreForbiddenParents: true
    }).note;
}

function setRuleError(note: BNote, message: string | null) {
    const existing = note.getOwnedAttribute("label", "reasoningError");
    if (!message) {
        if (existing) {
            existing.markAsDeleted();
        }
        return;
    }
    const text = message.length > 500 ? `${message.slice(0, 499)}…` : message;
    if (existing) {
        if (existing.value !== text) {
            existing.value = text;
            existing.save();
        }
        return;
    }
    attributeService.createLabel(note.noteId, "reasoningError", text);
}

function factStillOwned(fact: StoredFact): boolean {
    const attr = becca.attributes[fact.attributeId];
    return !!attr
        && !attr.isDeleted
        && attr.noteId === fact.noteId
        && attr.type === fact.type
        && attr.name === fact.name
        && attr.value === fact.value;
}

/** Ids removed from provenance after this run read it, so the run does not write them back. */
function releasedSince(snapshot: readonly StoredFact[]): Set<string> {
    const note = becca.notes[PROVENANCE_NOTE_ID];
    const current = new Set((note && !note.isDeleted ? readProvenance(note) : []).map((fact) => fact.attributeId));
    const released = new Set<string>();
    for (const fact of snapshot) {
        if (!current.has(fact.attributeId)) {
            released.add(fact.attributeId);
        }
    }
    return released;
}

function factKey(fact: { noteId: string; type: string; name: string; value: string }): string {
    return `${fact.noteId}\n${fact.type}\n${fact.name}\n${fact.value}`;
}

function isStoredFact(value: unknown): value is StoredFact {
    if (!value || typeof value !== "object") {
        return false;
    }
    const fact = value as Partial<StoredFact>;
    return typeof fact.attributeId === "string"
        && typeof fact.noteId === "string"
        && (fact.type === "label" || fact.type === "relation")
        && typeof fact.name === "string"
        && typeof fact.value === "string";
}

function describeDiagnostic(diagnostic: RuleDiagnostic): string {
    const name = diagnostic.name ?? "";
    const detail = diagnostic.detail ?? "";
    switch (diagnostic.code) {
        case "parse":
            return t("reasoning.parse", { line: diagnostic.line ?? 0, detail });
        case "unscoped":
            return t("reasoning.unscoped", { name });
        case "unsafe":
            return t("reasoning.unsafe", { name });
        case "global_not_schema":
            return t("reasoning.global_not_schema");
        case "unknown_note":
            return t("reasoning.unknown_note", { name });
        case "ambiguous_note":
            return t("reasoning.ambiguous_note", { name });
        case "type":
            return t("reasoning.type", { name, detail });
        case "arity":
            return t("reasoning.arity", { name, detail });
        case "reserved":
            return t("reasoning.reserved", { name });
        case "builtin":
            return t("reasoning.builtin", { name });
        default:
            return t("reasoning.engine", { detail: diagnostic.code });
    }
}

function eventArms(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") {
        return false;
    }
    const record = payload as {
        entityName?: string;
        entity?: { name?: string; noteId?: string; value?: string; type?: string; hasLabel?: (name: string) => boolean };
        hasLabel?: (name: string) => boolean;
        noteId?: string;
    };

    if (typeof record.hasLabel === "function") {
        return record.hasLabel("reasoningRule") && !record.noteId?.startsWith("_");
    }

    const entity = record.entity;
    if (!entity) {
        return false;
    }
    if (record.entityName === "attributes" && entity.name === "reasoningRule") {
        return typeof entity.noteId === "string" && !entity.noteId.startsWith("_");
    }
    if (record.entityName === "attributes" && entity.type === "relation" && entity.name === "template" && typeof entity.value === "string") {
        return !!becca.notes[entity.value]?.getOwnedAttribute("label", "reasoningRule");
    }
    if (typeof entity.hasLabel === "function") {
        return entity.hasLabel("reasoningRule") && !entity.noteId?.startsWith("_");
    }
    return false;
}

function scheduleReasoning() {
    oneTimeTimer.scheduleExecution("reasoning", 400, () => {
        void runReasoning().catch((error) => {
            getLog().error(`Reasoning failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
}

function htmlToPlain(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ");
}
