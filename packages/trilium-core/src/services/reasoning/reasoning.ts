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
import { addSubtree, collectTouch, type ReasoningChange, wakes } from "./activate.js";
import {
    dropBackEdges,
    inferFacts,
    type InferenceQuery,
    type InferredFact,
    type ProjectedNote
} from "./evaluate.js";
import {
    assembleRules,
    type ClauseInterest,
    compileRuleNote,
    type IdbPredicate,
    predicateKey,
    queryFor,
    type ResolvedScope,
    type RuleDiagnostic,
    resolveScope,
    type Scope,
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

const BURST_CAP = 8;
/** Notes that gained a conclusion and are activated from the one that was opened. */
const SPREAD_CAP = 8;
const OPEN_DELAY_MS = 200;

interface RunnableClause {
    edn: string;
    form: "label" | "relation";
    name: string;
    arity: 1 | 2;
    symbol: string;
    interest: ClauseInterest;
    ruleNoteId: string;
    mode: Scope["mode"];
    workspaceNoteId: string | null;
    anchorNoteId: string | null;
    templateNoteId: string | null;
    query: InferenceQuery;
}

interface Program {
    clauses: RunnableClause[];
    ruleIds: Set<string>;
    ruleCount: number;
}

interface Covered {
    notes: ReadonlySet<string>;
    writes: ReadonlySet<string>;
}

let started = false;
let running = false;
let rerun = false;
let burst = 0;
let chain: Promise<ReasoningReport> | null = null;
let program: Program | null = null;
let activating = false;
let openNoteId: string | null = null;
const pending: ReasoningChange[] = [];
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
            const change = describeChange(payload);
            if (!change) {
                return;
            }
            if (running) {
                // `executeActivation` follows the conclusions it just wrote.
                if (activating && change.kind !== "rule") {
                    return;
                }
                pending.push(change);
                rerun = true;
                return;
            }
            if (change.kind !== "rule" && program && !programWakes(program, change)) {
                return;
            }
            pending.push(change);
            scheduleReasoning(false);
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
    chain = getContext().init(() => execute(() => executeOnce())).finally(() => {
        chain = null;
        finishRun();
    });
    return chain;
}

/** Rechecks `changes` against the notes next to them. A rule change runs the full pass. */
export function runReasoningOn(changes: readonly ReasoningChange[]): Promise<ReasoningReport> {
    if (chain) {
        return chain;
    }
    chain = getContext().init(() => execute(() => executeIncremental(changes))).finally(() => {
        chain = null;
        finishRun();
    });
    return chain;
}

/**
 * Applies the rules the neighborhood of `noteId` can answer, then activates notes that gained
 * a conclusion. A descendant rule whose tree is larger than the neighborhood waits for a full pass.
 */
export function activateNote(noteId: string): Promise<ReasoningReport> {
    if (!noteId || noteId.startsWith("_")) {
        return Promise.resolve(lastReport);
    }
    if (chain) {
        openNoteId = noteId;
        return chain;
    }
    chain = getContext().init(() => execute(() => executeActivation(noteId))).finally(() => {
        chain = null;
        finishRun();
    });
    return chain;
}

/** Schedules `activateNote` for the note just opened. A quick series keeps the last note. */
export function noteOpened(noteId: string) {
    if (!noteId || noteId.startsWith("_")) {
        return;
    }
    openNoteId = noteId;
    if (chain) {
        return;
    }
    oneTimeTimer.scheduleExecution("reasoning-open", OPEN_DELAY_MS, () => {
        const id = openNoteId;
        openNoteId = null;
        if (!id) {
            return;
        }
        void activateNote(id).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            getLog().error(`Reasoning failed: ${message}`);
        });
    });
}

function finishRun() {
    if (rerun) {
        rerun = false;
        burst += 1;
        if (burst >= BURST_CAP) {
            pending.length = 0;
        } else {
            scheduleReasoning(true);
        }
    } else {
        burst = 0;
    }
    if (openNoteId && !chain) {
        noteOpened(openNoteId);
    }
}

async function execute(body: () => Promise<ReasoningReport>): Promise<ReasoningReport> {
    running = true;
    try {
        lastReport = await body();
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
        program = null;
        return { ruleNotes: 0, inferred: 0, retracted: 0, errors: [] };
    }

    const messages = new Map<string, string[]>();
    const ruleIds = new Set(ruleNotes.map((note) => note.noteId));
    const inferredIds = new Set(stored.map((fact) => fact.attributeId));
    const titles = noteTitles();

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

    const built: RunnableClause[] = [];

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
            const key = predicateKey(clause.form, clause.arity, clause.name);
            const query: InferenceQuery = {
                form: clause.form,
                name: clause.name,
                arity: clause.arity,
                symbol: clause.symbol,
                ruleNoteIds: definers.get(key) ?? [note.noteId],
                query: queryFor(clause.form, clause.arity, clause.symbol)
            };
            built.push({
                edn: clause.edn,
                form: clause.form,
                name: clause.name,
                arity: clause.arity,
                symbol: clause.symbol,
                interest: clause.interest,
                ruleNoteId: note.noteId,
                mode: resolved.scope.mode,
                workspaceNoteId: resolved.scope.workspaceNoteId ?? null,
                anchorNoteId: resolved.scope.anchorNoteId ?? null,
                templateNoteId: resolved.scope.templateNoteId ?? null,
                query
            });
        }
    }
    program = { clauses: built, ruleIds, ruleCount: ruleNotes.length };
    const queries = queriesOf(built);
    const clauseEdn = built.map((clause) => clause.edn);
    const graph = projectGraph(ruleIds, inferredIds, notesForFullPass(built));

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

    const applied = applyFacts(inferred.facts, stored, null);
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
        wantsGlobal: scopeLabel?.value === "global",
        workspaceId: workspaceOf(note)
    };
}

function workspaceOf(note: BNote): string | null {
    const seen = new Set<string>();
    const queue = [note];
    let index = 0;
    while (index < queue.length) {
        const current = queue[index];
        index += 1;
        if (!current || seen.has(current.noteId)) {
            continue;
        }
        seen.add(current.noteId);
        if (current.getOwnedAttribute("label", "workspace")) {
            return current.noteId;
        }
        for (const parent of current.getParentNotes()) {
            if (parent.noteId === "root" || parent.noteId.startsWith("_")) {
                continue;
            }
            queue.push(parent);
        }
    }
    return null;
}

function projectGraph(
    ruleIds: ReadonlySet<string>,
    inferredIds: ReadonlySet<string>,
    only: ReadonlySet<string> | null
): ProjectedNote[] {
    const included: BNote[] = [];
    for (const note of Object.values(becca.notes)) {
        if (!note || note.isDeleted || note.noteId.startsWith("_")) {
            continue;
        }
        if (only && !only.has(note.noteId)) {
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

function applyFacts(
    desired: readonly InferredFact[],
    stored: readonly StoredFact[],
    covered: Covered | null
): { retracted: number; next: StoredFact[] } {
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
    type Row = { attributeId: string; noteId: string; type: string; name: string; value: string };
    const manualFrom = (attrs: readonly Row[]) => {
        for (const attr of attrs) {
            if (storedIds.has(attr.attributeId)) {
                continue;
            }
            manual.add(factKey(attr));
        }
    };
    if (covered) {
        const attrs: Row[] = [];
        for (const noteId of covered.notes) {
            const note = becca.notes[noteId];
            if (!note) {
                continue;
            }
            for (const attr of note.getOwnedAttributes()) {
                attrs.push(attr);
            }
        }
        manualFrom(attrs);
    } else {
        manualFrom(Object.values(becca.attributes));
    }

    let retracted = 0;
    const next: StoredFact[] = [];
    for (const [key, fact] of storedByKey) {
        if (desiredByKey.has(key)) {
            continue;
        }
        if (covered && !inZone(fact, covered)) {
            next.push(fact);
            continue;
        }
        const attr = becca.attributes[fact.attributeId];
        if (!attr) {
            continue;
        }
        attr.markAsDeleted();
        retracted += 1;
    }

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

function describeChange(payload: unknown): ReasoningChange | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const record = payload as {
        entityName?: string;
        entity?: {
            name?: string;
            noteId?: string;
            value?: string;
            type?: string;
            parentNoteId?: string;
            hasLabel?: (name: string) => boolean;
        };
        hasLabel?: (name: string) => boolean;
        noteId?: string;
    };

    if (typeof record.hasLabel === "function" && typeof record.noteId === "string") {
        if (record.noteId.startsWith("_")) {
            return null;
        }
        if (record.hasLabel("reasoningRule")) {
            return { noteId: record.noteId, kind: "rule" };
        }
        return { noteId: record.noteId, kind: "title" };
    }

    const entity = record.entity;
    if (!entity || typeof entity.noteId !== "string" || entity.noteId.startsWith("_")) {
        return null;
    }

    if (record.entityName === "attributes") {
        const name = entity.name ?? "";
        const structural = name === "reasoningRule" || name === "reasoningScope"
            || name === "reasoningSchema" || name === "workspace";
        if (structural) {
            return { noteId: entity.noteId, kind: "rule" };
        }
        if (entity.type === "relation" && name === "template") {
            return { noteId: entity.noteId, kind: "rule" };
        }
        if (entity.type === "relation") {
            return { noteId: entity.noteId, kind: "relation", name };
        }
        return { noteId: entity.noteId, kind: "label", name };
    }

    if (record.entityName === "branches") {
        const childId = entity.noteId;
        const parentId = entity.parentNoteId;
        const child = becca.notes[childId];
        const parent = parentId ? becca.notes[parentId] : undefined;
        if (child?.hasLabel("reasoningRule") || parent?.hasLabel("reasoningRule")) {
            return { noteId: childId, kind: "rule" };
        }
        return { noteId: childId, kind: "structure" };
    }

    if (typeof entity.hasLabel === "function") {
        if (entity.hasLabel("reasoningRule")) {
            return { noteId: entity.noteId, kind: "rule" };
        }
        return { noteId: entity.noteId, kind: "content" };
    }
    return null;
}

function scheduleReasoning(fromRerun: boolean) {
    if (!fromRerun) {
        burst = 0;
    }
    oneTimeTimer.scheduleExecution("reasoning", 400, () => {
        const changes = pending.splice(0, pending.length);
        const full = !program || changes.length === 0 || changes.some((change) => change.kind === "rule");
        const run = full ? runReasoning() : runReasoningOn(changes);
        void run.catch((error) => {
            getLog().error(`Reasoning failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
}

async function executeIncremental(changes: readonly ReasoningChange[]): Promise<ReasoningReport> {
    if (!program || changes.some((change) => change.kind === "rule")) {
        return executeOnce();
    }
    const selected = selectClauses(program, changes);
    if (selected.length === 0) {
        return lastReport;
    }

    const seeds = [...new Set(changes.map((change) => change.noteId))];
    const needsDescendant = selected.some((clause) => clause.interest.descendant);
    const workspaces = new Set<string>();
    let globalDescendant = false;
    for (const clause of selected) {
        if (clause.workspaceNoteId) {
            workspaces.add(clause.workspaceNoteId);
        } else if (clause.interest.descendant) {
            globalDescendant = true;
        }
    }
    const stopAt = !globalDescendant && workspaces.size === 1 ? [...workspaces][0] ?? null : null;
    const touch = collectTouch(seeds, needsDescendant, stopAt);
    if (!touch.complete) {
        return executeOnce();
    }

    const ids = touch.ids;
    for (const clause of selected) {
        if (clause.anchorNoteId) {
            ids.add(clause.anchorNoteId);
        }
        if (clause.templateNoteId) {
            ids.add(clause.templateNoteId);
        }
        if (clause.workspaceNoteId) {
            ids.add(clause.workspaceNoteId);
        }
    }

    const provenanceNote = becca.notes[PROVENANCE_NOTE_ID];
    const stored = provenanceNote ? readProvenance(provenanceNote) : [];
    const inferredIds = new Set(stored.map((fact) => fact.attributeId));
    const graph = projectGraph(program.ruleIds, inferredIds, ids);
    const queries = queriesOf(selected);
    const inferred = await inferFacts(graph, assembleRules(selected.map((clause) => clause.edn)), queries);
    if (inferred.failures.length > 0) {
        return executeOnce();
    }

    const writes = new Set(selected.map((clause) => `${clause.form}\n${clause.name}`));
    const applied = applyFacts(inferred.facts, stored, { notes: ids, writes });
    const released = releasedSince(stored);
    const next = released.size === 0
        ? applied.next
        : applied.next.filter((fact) => !released.has(fact.attributeId));
    writeProvenance(next);

    return {
        ruleNotes: program.ruleCount,
        inferred: applied.next.length,
        retracted: applied.retracted,
        errors: lastReport.errors
    };
}

interface ActivationStep {
    notes: string[];
    retracted: number;
    inferred: number;
}

async function executeActivation(seed: string): Promise<ReasoningReport> {
    if (!program) {
        return executeOnce();
    }
    if (program.clauses.length === 0) {
        return lastReport;
    }
    const note = becca.notes[seed];
    if (!note || note.isDeleted) {
        return lastReport;
    }

    activating = true;
    const activated = new Set<string>();
    const queue = [seed];
    let index = 0;
    let retracted = 0;
    let inferred = lastReport.inferred;
    try {
        while (index < queue.length && activated.size < SPREAD_CAP) {
            const id = queue[index];
            index += 1;
            if (!id || activated.has(id) || id.startsWith("_")) {
                continue;
            }
            const current = becca.notes[id];
            if (!current || current.isDeleted) {
                continue;
            }
            activated.add(id);
            const step = await applyAround(id, id === seed);
            retracted += step.retracted;
            inferred = step.inferred;
            for (const other of step.notes) {
                if (!activated.has(other) && !queue.includes(other)) {
                    queue.push(other);
                }
            }
        }
    } finally {
        activating = false;
    }

    return {
        ruleNotes: program.ruleCount,
        inferred,
        retracted,
        errors: lastReport.errors
    };
}

/** Runs the rules `seed` can answer. Retracts in that neighborhood only when `retract` is set. */
async function applyAround(seed: string, retract: boolean): Promise<ActivationStep> {
    const current = program;
    if (!current) {
        return { notes: [], retracted: 0, inferred: lastReport.inferred };
    }
    const selected = current.clauses.filter((clause) => !clause.interest.descendant);
    const deep = current.clauses.filter((clause) => clause.interest.descendant);
    const ids = collectTouch([seed], false, null).ids;
    if (deep.length > 0) {
        const deepTouch = collectTouch([seed], true, descendantStop(deep));
        if (deepTouch.complete) {
            for (const id of deepTouch.ids) {
                ids.add(id);
            }
            for (const clause of deep) {
                selected.push(clause);
            }
        }
    }
    if (selected.length === 0) {
        return { notes: [], retracted: 0, inferred: lastReport.inferred };
    }
    for (const clause of selected) {
        if (clause.anchorNoteId) {
            ids.add(clause.anchorNoteId);
        }
        if (clause.templateNoteId) {
            ids.add(clause.templateNoteId);
        }
        if (clause.workspaceNoteId) {
            ids.add(clause.workspaceNoteId);
        }
    }

    const provenanceNote = becca.notes[PROVENANCE_NOTE_ID];
    const stored = provenanceNote ? readProvenance(provenanceNote) : [];
    const before = new Set<string>();
    for (const fact of stored) {
        if (factStillOwned(fact)) {
            before.add(factKey(fact));
        }
    }
    const inferredIds = new Set(stored.map((fact) => fact.attributeId));
    const graph = projectGraph(current.ruleIds, inferredIds, ids);
    const rules = assembleRules(selected.map((clause) => clause.edn));
    const inferred = await inferFacts(graph, rules, queriesOf(selected));
    if (inferred.failures.length > 0) {
        return { notes: [], retracted: 0, inferred: lastReport.inferred };
    }

    const writes = new Set<string>();
    if (retract) {
        for (const clause of selected) {
            writes.add(`${clause.form}\n${clause.name}`);
        }
    }
    const applied = applyFacts(inferred.facts, stored, { notes: ids, writes });
    const released = releasedSince(stored);
    const next = released.size === 0
        ? applied.next
        : applied.next.filter((fact) => !released.has(fact.attributeId));
    writeProvenance(next);

    const notes: string[] = [];
    const seen = new Set<string>();
    for (const fact of next) {
        if (before.has(factKey(fact)) || seen.has(fact.noteId)) {
            continue;
        }
        seen.add(fact.noteId);
        notes.push(fact.noteId);
    }
    return { notes, retracted: applied.retracted, inferred: next.length };
}

function descendantStop(clauses: readonly RunnableClause[]): string | null {
    const workspaces = new Set<string>();
    let globalDescendant = false;
    for (const clause of clauses) {
        if (clause.workspaceNoteId) {
            workspaces.add(clause.workspaceNoteId);
        } else {
            globalDescendant = true;
        }
    }
    if (globalDescendant || workspaces.size !== 1) {
        return null;
    }
    return [...workspaces][0] ?? null;
}

function selectClauses(current: Program, changes: readonly ReasoningChange[]): RunnableClause[] {
    const writes = new Set<string>();
    for (const clause of current.clauses) {
        for (const change of changes) {
            if (wakes(clause.interest, change)) {
                writes.add(`${clause.form}\n${clause.name}`);
                break;
            }
        }
    }
    if (writes.size === 0) {
        return [];
    }
    return current.clauses.filter((clause) => writes.has(`${clause.form}\n${clause.name}`));
}

function programWakes(current: Program, change: ReasoningChange): boolean {
    for (const clause of current.clauses) {
        if (wakes(clause.interest, change)) {
            return true;
        }
    }
    return false;
}

function queriesOf(clauses: readonly RunnableClause[]): InferenceQuery[] {
    const queries: InferenceQuery[] = [];
    const seen = new Set<string>();
    for (const clause of clauses) {
        if (seen.has(clause.symbol)) {
            continue;
        }
        seen.add(clause.symbol);
        queries.push(clause.query);
    }
    return queries;
}

function inZone(fact: StoredFact, covered: Covered): boolean {
    return covered.notes.has(fact.noteId) && covered.writes.has(`${fact.type}\n${fact.name}`);
}

function noteTitles(): Map<string, string[]> {
    const titles = new Map<string, string[]>();
    for (const note of Object.values(becca.notes)) {
        if (!note || note.isDeleted || note.noteId.startsWith("_") || !note.isContentAvailable()) {
            continue;
        }
        const list = titles.get(note.title) ?? [];
        list.push(note.noteId);
        titles.set(note.title, list);
    }
    return titles;
}

/** Notes a full pass has to load. `null` is the whole database. */
function notesForFullPass(clauses: readonly RunnableClause[]): Set<string> | null {
    if (clauses.some((clause) => clause.mode === "global" || !clause.workspaceNoteId)) {
        return null;
    }

    const ids = new Set<string>();
    const templates = new Set<string>();
    for (const clause of clauses) {
        if (clause.workspaceNoteId) {
            addSubtree(clause.workspaceNoteId, ids, Number.POSITIVE_INFINITY);
        }
        if (clause.anchorNoteId) {
            ids.add(clause.anchorNoteId);
        }
        if (clause.templateNoteId) {
            templates.add(clause.templateNoteId);
            ids.add(clause.templateNoteId);
        }
    }
    for (const rel of becca.findAttributes("relation", "template")) {
        if (!templates.has(rel.value) || rel.noteId.startsWith("_")) {
            continue;
        }
        ids.add(rel.noteId);
        const instance = becca.notes[rel.noteId];
        if (!instance || instance.isDeleted) {
            continue;
        }
        for (const child of instance.getChildNotes()) {
            if (!child.noteId.startsWith("_")) {
                ids.add(child.noteId);
            }
        }
    }

    const snapshot = [...ids];
    for (const id of snapshot) {
        const note = becca.notes[id];
        if (!note) {
            continue;
        }
        for (const attr of note.getOwnedAttributes()) {
            if (attr.type === "relation" && attr.value && !attr.value.startsWith("_")) {
                ids.add(attr.value);
            }
        }
        for (const incoming of note.getTargetRelations()) {
            if (!incoming.isDeleted && !incoming.noteId.startsWith("_")) {
                ids.add(incoming.noteId);
            }
        }
    }
    addNamedTitles(clauses, ids);
    return ids;
}

function addNamedTitles(clauses: readonly RunnableClause[], ids: Set<string>) {
    const titles = noteTitles();
    for (const clause of clauses) {
        const pattern = /"note\/title" ("(?:\\.|[^"\\])*")/g;
        let match = pattern.exec(clause.edn);
        while (match) {
            const raw = match[1];
            if (raw) {
                try {
                    const title = JSON.parse(raw) as string;
                    for (const noteId of titles.get(title) ?? []) {
                        ids.add(noteId);
                    }
                } catch {
                    // The rule reports the missing title when the next full pass compiles it.
                }
            }
            match = pattern.exec(clause.edn);
        }
    }
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
