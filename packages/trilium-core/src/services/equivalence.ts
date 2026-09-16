import {
    equivLabelName,
    type EquivalentNoteMember,
    type EquivalentNotesGroup,
    type EquivalentNotesResponse,
    type NoteMapNote
} from "@triliumnext/commons";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import optionService from "./options.js";

/** Builtin equivalence relation: always an equivalence type and always self-inverse. */
export const EQUIV_RELATION_NAME = "equiv";

export interface EquivalenceTypeConfig {
    name: string;
    expandSearch: boolean;
    collapseMap: boolean;
}

const NONE_COLLAPSE_VALUE = "none";

export interface MapLink {
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    name: string;
}

export interface CanonicalPickInput {
    members: string[];
    preferredNoteId?: string;
    canonicalNoteIds: Set<string>;
    languageByNoteId: Map<string, string>;
    locale: string;
}

/**
 * Connected components of an undirected graph given as edges. Isolated vertices that never appear
 * in an edge are omitted — a note with no equivalence relation is its own trivial class.
 */
export function connectedComponents(edges: [string, string][]): Map<string, string[]> {
    const parent = new Map<string, string>();

    function find(id: string): string {
        if (!parent.has(id)) {
            parent.set(id, id);
        }
        let current = parent.get(id) ?? id;
        while (parent.get(current) !== current) {
            const next = parent.get(current);
            if (next === undefined) {
                break;
            }
            current = next;
        }
        parent.set(id, current);
        return current;
    }

    function union(a: string, b: string) {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) {
            parent.set(rootA, rootB);
        }
    }

    for (const [source, target] of edges) {
        if (!source || !target || source === target) {
            continue;
        }
        union(source, target);
    }

    const groups = new Map<string, string[]>();
    for (const id of parent.keys()) {
        const root = find(id);
        const members = groups.get(root);
        if (members) {
            members.push(id);
        } else {
            groups.set(root, [id]);
        }
    }

    return groups;
}

/**
 * Picks the display representative of a class: an explicit `#canonical` member, else a member
 * whose `#language` matches the UI locale, else `preferredNoteId` if it belongs, else the
 * lexicographically smallest id (stable, not title-order).
 */
export function pickCanonicalMember(input: CanonicalPickInput): string {
    const { members, preferredNoteId, canonicalNoteIds, languageByNoteId, locale } = input;
    if (members.length === 0) {
        return preferredNoteId ?? "";
    }

    for (const id of members) {
        if (canonicalNoteIds.has(id)) {
            return id;
        }
    }

    if (locale) {
        const localePrefix = locale.toLowerCase();
        for (const id of members) {
            const language = languageByNoteId.get(id);
            if (language && languageMatchesLocale(language, localePrefix)) {
                return id;
            }
        }
    }

    if (preferredNoteId && members.includes(preferredNoteId)) {
        return preferredNoteId;
    }

    return [...members].sort()[0] ?? preferredNoteId ?? "";
}

export function languageMatchesLocale(language: string, localePrefix: string): boolean {
    const normalized = language.toLowerCase();
    return normalized === localePrefix || normalized.startsWith(`${localePrefix}-`)
        || localePrefix.startsWith(`${normalized}-`);
}

/**
 * Rewrites a link map so each equivalence class under the given mapping becomes one supernode.
 * `canonicalOf` maps every member (including the canonical) to its canonical id. Titles of
 * collapsed nodes join with " / ". Self-loops from collapsed edges are dropped; remaining
 * duplicate (source, target, name) links merge into one.
 */
export function collapseLinkMap(
    notes: NoteMapNote[],
    links: MapLink[],
    descendantCounts: Record<string, number>,
    canonicalOf: Map<string, string>,
    classTitles: Map<string, string>
): { notes: NoteMapNote[]; links: MapLink[]; noteIdToDescendantCountMap: Record<string, number> } {
    const seenCanonical = new Set<string>();
    const collapsedNotes: NoteMapNote[] = [];

    for (const [noteId, title, type, color, icon] of notes) {
        const canonicalId = canonicalOf.get(noteId) ?? noteId;
        if (seenCanonical.has(canonicalId)) {
            continue;
        }
        seenCanonical.add(canonicalId);
        const displayTitle = classTitles.get(canonicalId) ?? title;
        const canonicalNote = notes.find((row) => row[0] === canonicalId);
        collapsedNotes.push([
            canonicalId,
            displayTitle,
            canonicalNote?.[2] ?? type,
            canonicalNote?.[3] ?? color,
            canonicalNote?.[4] ?? icon
        ]);
    }

    const mergedLinks: MapLink[] = [];
    const seenLink = new Set<string>();
    for (const link of links) {
        const sourceNoteId = canonicalOf.get(link.sourceNoteId) ?? link.sourceNoteId;
        const targetNoteId = canonicalOf.get(link.targetNoteId) ?? link.targetNoteId;
        if (sourceNoteId === targetNoteId) {
            continue;
        }
        const key = `${sourceNoteId}\0${link.name}\0${targetNoteId}`;
        if (seenLink.has(key)) {
            continue;
        }
        seenLink.add(key);
        mergedLinks.push({
            id: `${sourceNoteId}-${link.name}-${targetNoteId}`,
            sourceNoteId,
            targetNoteId,
            name: link.name
        });
    }

    const noteIdToDescendantCountMap: Record<string, number> = {};
    for (const [noteId, count] of Object.entries(descendantCounts)) {
        const canonicalId = canonicalOf.get(noteId) ?? noteId;
        noteIdToDescendantCountMap[canonicalId] = (noteIdToDescendantCountMap[canonicalId] ?? 0) + count;
    }

    return { notes: collapsedNotes, links: mergedLinks, noteIdToDescendantCountMap };
}

/**
 * Equivalence types currently in the document. `~equiv` is always present and expands/collapses
 * by default. Other names come from any note's
 * relation definition marked `equivalence` — the type is global, not inherited along the class.
 */
export function getEquivalenceTypeConfigs(): EquivalenceTypeConfig[] {
    const byName = new Map<string, EquivalenceTypeConfig>();
    byName.set(EQUIV_RELATION_NAME, {
        name: EQUIV_RELATION_NAME,
        expandSearch: true,
        collapseMap: true
    });

    for (const attr of becca.findAttributesWithPrefix("label", "relation:")) {
        if (!attr.isDefinition()) {
            continue;
        }
        const definition = attr.getDefinition();
        if (!definition.isEquivalence) {
            continue;
        }
        const definedName = attr.getDefinedName();
        if (!definedName) {
            continue;
        }
        if (definedName === EQUIV_RELATION_NAME) {
            byName.set(EQUIV_RELATION_NAME, {
                name: EQUIV_RELATION_NAME,
                expandSearch: definition.expandSearch ?? true,
                collapseMap: definition.collapseMap ?? true
            });
        } else {
            byName.set(definedName, {
                name: definedName,
                expandSearch: !!definition.expandSearch,
                collapseMap: !!definition.collapseMap
            });
        }
    }

    return [...byName.values()];
}

export function getEquivalenceTypeNames(): string[] {
    return getEquivalenceTypeConfigs().map((config) => config.name);
}

export function isEquivalenceType(name: string): boolean {
    return getEquivalenceTypeNames().includes(name);
}

/**
 * Types search should expand: an explicit list wins; otherwise all types, or only those marked
 * `expandSearch`, or none.
 */
export function resolveTypesToExpand(opts: {
    enabled: boolean;
    expandAll: boolean;
    requestedTypes: string[];
}): string[] {
    const configs = getEquivalenceTypeConfigs();
    const known = new Set(configs.map((config) => config.name));
    if (opts.requestedTypes.length > 0) {
        return opts.requestedTypes.filter((name) => known.has(name));
    }
    if (!opts.enabled) {
        return [];
    }
    if (opts.expandAll) {
        return [...known];
    }
    return configs.filter((config) => config.expandSearch).map((config) => config.name);
}

/**
 * Types the link map should collapse. An explicit `#mapCollapseRelation` list wins; `none` disables
 * collapse on that map; otherwise types marked `collapseMap`.
 */
export function resolveTypesToCollapse(requestedTypes: string[]): string[] {
    const configs = getEquivalenceTypeConfigs();
    const known = new Set(configs.map((config) => config.name));
    if (requestedTypes.includes(NONE_COLLAPSE_VALUE)) {
        return [];
    }
    if (requestedTypes.length > 0) {
        return requestedTypes.filter((name) => known.has(name));
    }
    return configs.filter((config) => config.collapseMap).map((config) => config.name);
}

/**
 * Members of `noteId`'s class under one type, including `noteId` itself and excluding `#equivHub`
 * notes (they join the class without belonging to it). A missing note or a type with no edges
 * yields just `[noteId]` when that note exists.
 */
export function getClassMembers(noteId: string, type: string): string[] {
    const components = componentsForType(type);
    const members = membersOf(noteId, components);
    return members.filter((id) => !isEquivHub(id, type));
}

/**
 * Independent union of per-type classes: A ≡_translation B and B ≡_entity C does not put A and C
 * in one class. Used by search expansion.
 */
export function getIndependentClassMembers(noteId: string, types: string[]): string[] {
    const out = new Set<string>();
    for (const type of types) {
        for (const id of getClassMembers(noteId, type)) {
            out.add(id);
        }
    }
    if (out.size === 0) {
        out.add(noteId);
    }
    return [...out];
}

/**
 * Connected component under the union of the given types' edge sets (cross-type transitivity).
 * Used when the user asks the note map to collapse by several types at once.
 */
export function getUnionClassMembers(noteId: string, types: string[]): string[] {
    const edges: [string, string][] = [];
    for (const type of types) {
        for (const edge of edgesForType(type)) {
            edges.push(edge);
        }
    }
    const components = connectedComponents(edges);
    return membersOf(noteId, components).filter((id) => !isEquivHub(id, types));
}

export function getCanonicalNoteId(members: string[], preferredNoteId?: string, types: string[] = [EQUIV_RELATION_NAME]): string {
    return pickCanonicalMember({
        members,
        preferredNoteId,
        canonicalNoteIds: collectCanonicalIds(members, types),
        languageByNoteId: collectLanguages(members),
        locale: readLocale()
    });
}

export function buildEquivalentNotesResponse(noteId: string): EquivalentNotesResponse {
    becca.getNoteOrThrow(noteId);

    const groups: EquivalentNotesGroup[] = [];
    for (const relationName of getEquivalenceTypeNames()) {
        const members = getClassMembers(noteId, relationName);
        const others = members.filter((id) => id !== noteId);
        if (others.length === 0) {
            continue;
        }

        groups.push({
            relationName,
            canonicalNoteId: getCanonicalNoteId(members, noteId, [relationName]),
            members: sortMembers(members.map((id) => toMember(id, relationName)), noteId)
        });
    }

    return { groups };
}

/**
 * Mapping from every class member to its canonical id, for collapsing a link map by `types`.
 * Notes that are not in any class of size > 1 map to themselves (omitted from the Map).
 */
export function buildCanonicalMapping(
    types: string[],
    preferredNoteId?: string
): { canonicalOf: Map<string, string>; classTitles: Map<string, string> } {
    const edges: [string, string][] = [];
    for (const type of types) {
        for (const edge of edgesForType(type)) {
            edges.push(edge);
        }
    }

    const canonicalOf = new Map<string, string>();
    const classTitles = new Map<string, string>();

    for (const members of connectedComponents(edges).values()) {
        const visible = members.filter((id) => !isEquivHub(id, types));
        if (visible.length < 2) {
            continue;
        }

        const canonicalId = getCanonicalNoteId(visible, preferredNoteId, types);
        const titles: string[] = [];
        const canonicalNote = becca.getNote(canonicalId);
        if (canonicalNote) {
            titles.push(memberMapTitle(canonicalNote, types));
        }
        const others = [...visible].filter((id) => id !== canonicalId).sort();
        for (const id of others) {
            const note = becca.getNote(id);
            if (note) {
                titles.push(memberMapTitle(note, types));
            }
            canonicalOf.set(id, canonicalId);
        }
        canonicalOf.set(canonicalId, canonicalId);
        classTitles.set(canonicalId, titles.join(" / "));
    }

    return { canonicalOf, classTitles };
}

export function isAllowedExpandedHit(note: BNote, opts: {
    includeArchivedNotes: boolean;
    includeHiddenNotes: boolean;
    ancestorNoteId?: string;
}): boolean {
    if (!opts.includeArchivedNotes && note.isArchived) {
        return false;
    }
    if (!opts.includeHiddenNotes && note.isInHiddenSubtree()) {
        return false;
    }
    if (opts.ancestorNoteId && opts.ancestorNoteId !== "root") {
        if (note.noteId !== opts.ancestorNoteId && !note.hasAncestor(opts.ancestorNoteId)) {
            return false;
        }
    }
    return true;
}

function componentsForType(type: string): Map<string, string[]> {
    return connectedComponents(edgesForType(type));
}

function edgesForType(type: string): [string, string][] {
    const edges: [string, string][] = [];
    for (const attr of becca.findAttributes("relation", type)) {
        if (attr.type !== "relation" || !attr.value) {
            continue;
        }
        edges.push([attr.noteId, attr.value]);
    }
    return edges;
}

function membersOf(noteId: string, components: Map<string, string[]>): string[] {
    for (const members of components.values()) {
        if (members.includes(noteId)) {
            return members;
        }
    }
    return becca.getNote(noteId) ? [noteId] : [];
}

function isEquivHub(noteId: string, types: string | string[]): boolean {
    const note = becca.getNote(noteId);
    if (!note) {
        return false;
    }
    const typeList = typeof types === "string" ? [types] : types;
    for (const type of typeList) {
        if (type === EQUIV_RELATION_NAME && note.isLabelTruthy("equivHub")) {
            return true;
        }
        if (note.isLabelTruthy(`equivHub:${type}`)) {
            return true;
        }
    }
    return false;
}

function collectCanonicalIds(members: string[], types: string[]): Set<string> {
    const ids = new Set<string>();
    for (const id of members) {
        const note = becca.getNote(id);
        if (!note) {
            continue;
        }
        for (const type of types) {
            if (type === EQUIV_RELATION_NAME && note.isLabelTruthy("canonical")) {
                ids.add(id);
                break;
            }
            if (note.isLabelTruthy(`canonical:${type}`)) {
                ids.add(id);
                break;
            }
        }
    }
    return ids;
}

function collectLanguages(members: string[]): Map<string, string> {
    const languages = new Map<string, string>();
    for (const id of members) {
        const language = becca.getNote(id)?.getLabelValue("language");
        if (language) {
            languages.set(id, language);
        }
    }
    return languages;
}

function readLocale(): string {
    try {
        return optionService.getOption("locale") || "en";
    } catch {
        return "en";
    }
}

function memberMapTitle(note: BNote, types: string[]): string {
    for (const type of types) {
        const label = note.getLabelValue(equivLabelName(type));
        if (label) {
            return label;
        }
    }
    return note.getTitleOrProtected();
}

function sortMembers(members: EquivalentNoteMember[], currentNoteId: string): EquivalentNoteMember[] {
    return [...members].sort((a, b) => {
        if (a.noteId === currentNoteId && b.noteId !== currentNoteId) {
            return -1;
        }
        if (b.noteId === currentNoteId && a.noteId !== currentNoteId) {
            return 1;
        }
        const nameA = a.displayName?.toLowerCase() ?? "\uffff";
        const nameB = b.displayName?.toLowerCase() ?? "\uffff";
        if (nameA !== nameB) {
            return nameA < nameB ? -1 : 1;
        }
        return a.title.localeCompare(b.title);
    });
}

function toMember(noteId: string, type: string): EquivalentNoteMember {
    const note = becca.getNote(noteId);
    const displayName = note?.getLabelValue(equivLabelName(type));
    return {
        noteId,
        title: note?.getTitleOrProtected() ?? noteId,
        icon: note?.getIcon() ?? "bx bx-note",
        ...(displayName ? { displayName } : {})
    };
}
