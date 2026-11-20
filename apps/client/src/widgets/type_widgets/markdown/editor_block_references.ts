import {
    FLASH_DURATION_MS, MIN_TOP_GAP
} from "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import {
    applyOutsideHistory, blockMarkers, type ChangeRecord, flashLines, getChangeRecord,
    rebaseChangeRecord, setChangeRecord, trackPositions, type TrackedPosition
} from "@triliumnext/codemirror/src/extensions/block_markers";
import type { FoundBlockId } from "@triliumnext/commons";
import { isSameBlockKey } from "@triliumnext/commons/src/lib/block_keys.js";
import { generateBlockId, parseBlockRange } from "@triliumnext/commons/src/lib/block_reference.js";
import {
    type BlockIndexHost, type IndexedBlock, indexMarkdownBlocks, type MarkdownBlockIndex
} from "@triliumnext/commons/src/lib/markdown_block_index.js";
import {
    applySourceChange, findMarkdownHeadings, type MarkdownHeading, placeMarkerOnBlock,
    replayBlockIds, type SourceChange
} from "@triliumnext/commons/src/lib/markdown_references.js";
import { sortAnchorNames } from "@triliumnext/commons/src/lib/reference_targets.js";
import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext, { type CommandNames } from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import { copyReferenceLink, flashBlockRange } from "../../../services/block_reference";
import { t } from "../../../services/i18n";
import type { ViewScope } from "../../../services/link";
import {
    addParameters, createEditorTarget, createSavedHeadingTarget, type LinkTarget
} from "../../../services/link_targets";
import type { ChangeRecordHooks, CurrentVersion } from "../../../services/note_save";
import toast from "../../../services/toast";
import { noteSavedDataStore } from "../../react/NoteStore";
import { type OwnLinkTargets, registerOwnLinkTargets } from "./editor_utils";

/** How the preview reads a Markdown note: DOMPurify, and a template, which loads no images. */
export const PREVIEW_BLOCK_HOST: BlockIndexHost = {
    sanitize: (html) => DOMPurify.sanitize(html),
    parse(html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        return template.content;
    }
};

/** The note that a Markdown editor edits, for the menus that copy references to its blocks. */
export interface MarkdownReferenceSource {
    getNote(): FNote | null | undefined;
    getNotePath(): string | null | undefined;
    /** The preview of the note, while it is mounted. */
    getPreview(): HTMLElement | null | undefined;
    /**
     * Saves the changes of the editor now, and resolves to the content of the note as saved, or
     * `undefined` while changes wait. Without it, the editor of the note's split saves it.
     */
    save?(): Promise<string | undefined>;
}

/**
 * Draws the block markers of `view` as chips and keeps them whole, as `blockMarkers()` does, and
 * lists the headings and anchors of its document for links to it. With `source`, the menus copy
 * references to its blocks, and the returned hooks, given to the saves of its editor, take over
 * the ids that another writer gave its blocks meanwhile. The hooks act on the latest `view`.
 */
export function useBlockMarkers(
    view: VanillaCodeMirror | null,
    source?: MarkdownReferenceSource
): ChangeRecordHooks {
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const viewRef = useRef(view);
    viewRef.current = view;
    const inFlightRef = useRef<InFlight | null>(null);

    useEffect(() => {
        if (!view) return;

        view.setNamedExtension("blockMarkers", blockMarkers({
            readMarkers: (doc) => indexMarkdownBlocks(doc, PREVIEW_BLOCK_HOST).markers,
            getTitle: (marker, isEffective) => (isEffective
                ? marker.id ?? ""
                : t("block_reference.inert_marker", { id: marker.id ?? "" })),
            openMenu: (marker, element) => openMarkerMenu(view, marker, element)
        }));
        const unregister = registerOwnLinkTargets(view, {
            read: (notePath, range) => readOwnLinkTargets(view, notePath, range),
            takePendingMarker: () => takePendingMarker(view)
        });
        markdownEditors.add(view);
        if (sourceRef.current) {
            const save = sourceRef.current.save
                ? async () => await sourceRef.current?.save?.()
                : undefined;
            sources.set(view, {
                getNote: () => sourceRef.current?.getNote(),
                getNotePath: () => sourceRef.current?.getNotePath(),
                getPreview: () => sourceRef.current?.getPreview(),
                save
            });
        }
        return () => {
            view.setNamedExtension("blockMarkers", []);
            unregister();
            markdownEditors.delete(view);
            sources.delete(view);
        };
    }, [ view ]);

    const [ hooks ] = useState<ChangeRecordHooks>(() => ({
        onDataTaken() {
            if (viewRef.current) {
                inFlightRef.current = takeRecord(viewRef.current, inFlightRef.current);
            }
        },
        dataSaved() {
            inFlightRef.current = null;
        },
        resolveConflict(current: CurrentVersion) {
            const shown = viewRef.current;
            if (!shown || !takeOverBlockIds(shown, inFlightRef.current, current)) {
                return false;
            }
            inFlightRef.current = null;
            return true;
        }
    }));
    return hooks;
}

/** The source that `useBlockMarkers()` registered for `view`, an editor of a Markdown note. */
export function getMarkdownReferenceSource(view: object) {
    return sources.get(view);
}

/** Whether `view` is an editor of Markdown that `useBlockMarkers()` draws the markers of. */
export function isMarkdownEditor(view: object) {
    return markdownEditors.has(view);
}

/**
 * The first and the last leaf block that the selection of `view` covers, as `index` lists them,
 * and how many leaf blocks lie from one to the other. A selection that ends at the start of a line
 * leaves that line out; a caret outside every block takes the block after it, else the one before.
 */
export function getSelectedBlocks(view: VanillaCodeMirror, index: MarkdownBlockIndex) {
    const { doc, selection } = view.state;
    const { from, to } = selection.main;
    const leaves = index.blocks.filter((block) => !block.isContainer);
    const firstLine = doc.lineAt(from).number;
    const lastLine = doc.lineAt(to).number - (to > from && doc.lineAt(to).from === to ? 1 : 0);

    let start = index.blockAt(firstLine) ?? leaves.find((block) => block.startLine > firstLine);
    let end = index.blockAt(lastLine)
        ?? [ ...leaves ].reverse().find((block) => block.endLine < lastLine);
    if (from === to) {
        start = end = start ?? end;
    }
    const first = start ? leaves.indexOf(start) : -1;
    const last = end ? leaves.indexOf(end) : -1;
    return start && end && first <= last ? { start, end, count: last - first + 1 } : null;
}

/**
 * Gives the blocks `start` and `end` of the document of `view` ids where they have none, in one
 * undo step, saves the note, flashes the blocks and copies a reference link to them. Nothing is
 * copied, and a toast says so, when the blocks cannot take ids or the note is not saved.
 */
export async function copyMarkdownReference(
    view: VanillaCodeMirror,
    start: IndexedBlock,
    end: IndexedBlock
) {
    const source = sources.get(view);
    const note = source?.getNote();
    const notePath = source?.getNotePath();
    if (!source || !note || !notePath) return;

    const placed = placeMarkdownBlockIds(view, start, end, { isUndoable: true });
    if (!placed) {
        toast.showError(t("block_reference.copy_failed"));
        return;
    }

    const { range, startOwner, endOwner } = placed;
    if (!await saveIds(source, note.noteId, range)) {
        toast.showError(t("block_reference.copy_failed"));
        return;
    }

    flashLines(view, startOwner.startLine, endOwner.endLine, FLASH_DURATION_MS);
    const preview = source.getPreview();
    if (preview?.clientHeight) {
        flashBlockRange(preview, range);
    }
    await copyReferenceLink(notePath, note.title, range, {
        start: startOwner.node as Element, end: endOwner.node as Element
    });
}

/**
 * Gives the blocks `start` and `end` of the document of `view` ids where they have none. With
 * `isUndoable`, the markers are one undo step, else they stay out of the history. Returns the ids
 * and the blocks that own them, or `null` when the blocks cannot take ids.
 */
export function placeMarkdownBlockIds(
    view: VanillaCodeMirror,
    start: IndexedBlock,
    end: IndexedBlock,
    { isUndoable }: { isUndoable: boolean }
) {
    const doc = view.state.doc.toString();
    const index = indexMarkdownBlocks(doc, PREVIEW_BLOCK_HOST);
    const startBlock = findSameBlock(index, start);
    const endBlock = findSameBlock(index, end);
    const startMarker = startBlock && placeMarkerOnBlock(doc, index, startBlock, {
        kind: "draw", createId: generateBlockId
    }, PREVIEW_BLOCK_HOST);
    const endMarker = startMarker && endBlock && endBlock !== startBlock
        ? placeMarkerOnBlock(doc, index, endBlock, {
            kind: "draw", createId: () => drawAnotherId(startMarker.id)
        }, PREVIEW_BLOCK_HOST)
        : startMarker;
    if (!startMarker || !endMarker) {
        return null;
    }

    // Both edits are on one document, and the two blocks are apart, so neither moves the other.
    const changes = [ startMarker.change, endMarker.change ]
        .filter((change, position, all): change is SourceChange =>
            !!change && all.indexOf(change) === position);
    const after = indexMarkdownBlocks(applyChanges(doc, changes), PREVIEW_BLOCK_HOST);
    const startOwner = after.resolve(startMarker.id);
    const endOwner = after.resolve(endMarker.id);
    if (!startOwner || !endOwner
        || after.blocks.indexOf(startOwner) > after.blocks.indexOf(endOwner)) {
        return null;
    }
    if (changes.length && isUndoable) {
        view.dispatch({ changes });
    } else if (changes.length) {
        applyOutsideHistory(view, changes);
    }

    return { range: { startId: startMarker.id, endId: endMarker.id }, startOwner, endOwner };
}

/**
 * The heading of the document of `view` whose block starts on `line`, for a link from outside the
 * editor, or `null` when no heading there can be linked. The target places its marker outside the
 * undo history, only while the document is the one read here, and confirms the id in the note as
 * saved on the server.
 */
export function getMarkdownHeadingTarget(
    view: VanillaCodeMirror,
    line: number,
    notePath: string,
    noteId: string
): LinkTarget | null {
    const { doc } = view.state;
    const heading = findHeadingOnLine(doc.toString(), line);
    if (!heading) return null;

    return createEditorTarget({
        noteId,
        notePath,
        title: heading.title,
        level: heading.level,
        assignId() {
            if (view.state.doc !== doc) return null;
            const placed = placeMarkdownBlockIds(view, heading.block, heading.block, {
                isUndoable: false
            });
            return placed?.range.startId;
        },
        isSaved: isMarkdownHeadingId
    });
}

/**
 * The heading whose block starts on `line` of `content`, the blob `blobId` of the note `noteId`,
 * for a view without an editor, or `null` when no heading there can be linked. The server finds
 * the heading by the same line in its own index of that blob.
 */
export function getSavedMarkdownHeadingTarget(
    noteId: string,
    notePath: string,
    content: string,
    line: number,
    blobId: string
): LinkTarget | null {
    const heading = findHeadingOnLine(content, line);
    return heading
        ? createSavedHeadingTarget(noteId, notePath, { line, title: heading.title, blobId })
        : null;
}

/** Whether `id` resolves to a heading in `content`, the source of a Markdown note. */
export function isMarkdownHeadingId(content: string, id: string) {
    return indexMarkdownBlocks(content, PREVIEW_BLOCK_HOST).resolve(id)?.key.kind === "heading";
}

/**
 * Scrolls the source of `view` to the blocks or the anchor that `viewScope` points at, which keeps
 * their first line in view, and highlights their lines when `isFlashed`. With `isConsumed`, the
 * parameter is cleared, and a missing block shows a toast.
 */
export function revealInSource(
    view: VanillaCodeMirror,
    viewScope: ViewScope,
    { isFlashed, isConsumed }: { isFlashed: boolean; isConsumed: boolean }
) {
    const index = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST);
    let lines: { from: number; to: number } | null = null;
    let isMissing = false;
    if (viewScope.block) {
        const range = parseBlockRange(viewScope.block);
        const ends = range ? [ index.resolve(range.startId), index.resolve(range.endId) ] : [];
        // The ends are read in document order, however the link writes them.
        const found = ends.filter((block): block is IndexedBlock => !!block)
            .sort((a, b) => index.blocks.indexOf(a) - index.blocks.indexOf(b));
        isMissing = found.length < 2;
        lines = found.length
            ? { from: found[0].startLine, to: found[found.length - 1].endLine }
            : null;
    } else if (viewScope.bookmark) {
        const anchor = index.anchors.find(({ name }) => name === viewScope.bookmark);
        lines = anchor ? { from: anchor.line, to: anchor.line } : null;
    }

    if (lines) {
        const line = view.state.doc.line(Math.min(lines.from, view.state.doc.lines));
        const { top } = view.lineBlockAt(line.from);
        view.scrollDOM.scrollTop = Math.max(0, top - view.scrollDOM.clientHeight * MIN_TOP_GAP);
        if (isFlashed) {
            flashLines(view, lines.from, lines.to, FLASH_DURATION_MS);
        }
    }
    if (isConsumed) {
        if (isMissing) {
            toast.showError(t("block_reference.not_found"));
        }
        viewScope.block = undefined;
        viewScope.bookmark = undefined;
    }
}

const sources = new WeakMap<object, MarkdownReferenceSource>();
const markdownEditors = new WeakSet<object>();

//#region Record of the changes since the base
/** The record of a save that is not confirmed yet. */
interface InFlight {
    /** The changes from the base to the content that the save took. */
    record: ChangeRecord;
    /** That content, from which the editor records the changes since. */
    doc: ChangeRecord["base"];
}

/** The changes of `view` since its base, through the save in flight, if there is one. */
function getTotalRecord(view: VanillaCodeMirror, inFlight: InFlight | null): ChangeRecord {
    const record = getChangeRecord(view.state);
    return inFlight && inFlight.doc === record.base
        ? { base: inFlight.record.base, changes: inFlight.record.changes.compose(record.changes) }
        : record;
}

/** Sets the changes so far aside for a save, and records those after it on their own. */
function takeRecord(view: VanillaCodeMirror, inFlight: InFlight | null): InFlight {
    const taken = { record: getTotalRecord(view, inFlight), doc: view.state.doc };
    setChangeRecord(view);
    return taken;
}

/**
 * Brings the ids that another writer gave blocks of `current` into the document of `view`, when
 * those ids are all that the other writer changed and each block they went to continues in the
 * document. Then `current` is the base of the editor. Returns whether it did.
 */
function takeOverBlockIds(
    view: VanillaCodeMirror,
    inFlight: InFlight | null,
    current: CurrentVersion
) {
    const record = getTotalRecord(view, inFlight);
    const base = record.base.toString();
    const replay = replayBlockIds(base, current.content, PREVIEW_BLOCK_HOST);
    if (!replay) return false;

    const doc = view.state.doc.toString();
    const index = indexMarkdownBlocks(doc, PREVIEW_BLOCK_HOST);
    const changes: SourceChange[] = [];
    const leaves: { id: string; leaf: IndexedBlock }[] = [];
    for (const { id, block } of replay.replayed) {
        const leaf = findContinuation(view, record, base, replay.index, block, index);
        const placed = leaf
            && placeMarkerOnBlock(doc, index, leaf, { kind: "given", id }, PREVIEW_BLOCK_HOST);
        if (!leaf || !placed) return false;
        leaves.push({ id, leaf });
        if (placed.change) {
            changes.push(placed.change);
        }
    }

    const after = indexMarkdownBlocks(applyChanges(doc, changes), PREVIEW_BLOCK_HOST);
    const isEachOnItsLeaf = leaves.every(({ id, leaf }) => {
        const owner = after.resolve(id);
        return owner && isSameBlockKey(owner.key, leaf.key)
            && after.blocks.indexOf(owner) === index.blocks.indexOf(leaf);
    });
    if (!isEachOnItsLeaf) return false;

    applyOutsideHistory(view, changes);
    rebaseChangeRecord(view, getTotalRecord(view, inFlight), replay.changes);
    return true;
}

/**
 * The leaf block of the document of `view` that continues `block` of `base`, the base of
 * `record`: some character of its text is unchanged, its two ends lie in that leaf, and no
 * unchanged text of another block of the base does. `undefined` when the changes since the base
 * split, replaced, deleted or joined it.
 */
function findContinuation(
    view: VanillaCodeMirror,
    { changes }: ChangeRecord,
    base: string,
    baseIndex: MarkdownBlockIndex,
    block: IndexedBlock,
    index: MarkdownBlockIndex
) {
    const { doc } = view.state;
    if (findUnchangedCharacter(base, block, changes) === undefined) return undefined;
    const leaf = index.blockAt(doc.lineAt(changes.mapPos(block.from, 1)).number);
    if (!leaf || leaf !== index.blockAt(doc.lineAt(changes.mapPos(block.to, -1)).number)) {
        return undefined;
    }

    const isJoined = baseIndex.blocks.some((other) => {
        const position = other === block || other.isContainer
            ? undefined
            : findUnchangedCharacter(base, other, changes);
        const mapped = position === undefined ? -1 : changes.mapPos(position, 1);
        return mapped >= leaf.from && mapped < leaf.to;
    });
    return isJoined ? undefined : leaf;
}

/** The first letter or digit of `block` that `changes` leave as it is, if any. */
function findUnchangedCharacter(
    source: string,
    block: IndexedBlock,
    changes: ChangeRecord["changes"]
) {
    for (let position = block.from; position < block.to; position++) {
        if (/[\p{L}\p{N}]/u.test(source[position])
            && !changes.touchesRange(position, position + 1)) {
            return position;
        }
    }
    return undefined;
}
//#endregion

//#region Targets of the editor's own document
/** The marker that the pick of a heading left for its link, and the document it was made on. */
interface PendingMarker {
    doc: ChangeRecord["base"];
    /** `null` when the pick was declined. */
    change: SourceChange | null;
}

const pendingMarkers = new WeakMap<object, PendingMarker>();

/**
 * The headings and anchors of the document of `view`, which link to the note at `notePath`. Each
 * heading keeps its place mapped through the changes made while the targets are listed, as does
 * `range`, and a heading picked leaves the marker that its link needs.
 */
function readOwnLinkTargets(
    view: VanillaCodeMirror,
    notePath: string,
    range?: { from: number; to: number }
): OwnLinkTargets {
    const source = view.state.doc.toString();
    const index = indexMarkdownBlocks(source, PREVIEW_BLOCK_HOST);
    const headings = findMarkdownHeadings(index);
    // An empty range keeps text inserted at it outside.
    const rangeEnds: TrackedPosition[] = range
        ? [
            { pos: range.from, assoc: range.from === range.to ? -1 : 1 },
            { pos: range.to, assoc: -1 }
        ]
        : [];
    // Text inserted at either end of a heading stays outside it.
    const tracked: TrackedPosition[] = [
        ...rangeEnds,
        ...headings.flatMap(({ block }): TrackedPosition[] => [
            { pos: block.from, assoc: 1 }, { pos: block.to, assoc: -1 }
        ])
    ];
    const readPositions = trackPositions(view, tracked);
    const firstHeading = range ? 2 : 0;

    const headingTargets = headings.map((heading, position): LinkTarget => ({
        kind: "heading",
        title: heading.title,
        level: heading.level,
        params: heading.id === undefined ? undefined : { block: heading.id },
        createLinkPath() {
            pendingMarkers.delete(view);
            const at = firstHeading + 2 * position;
            const positions = readPositions();
            const listed = {
                heading, text: source.slice(heading.block.from, heading.block.to)
            };
            const id = heading.id
                ?? markHeading(view, listed, positions?.[at], positions?.[at + 1]);
            return id ? addParameters(notePath, { block: id }) : notePath;
        }
    }));
    return {
        headings: headingTargets,
        anchors: sortAnchorNames(index.anchors.map(({ name }) => name)),
        getRange() {
            const positions = readPositions();
            return range && positions ? { from: positions[0], to: positions[1] } : null;
        }
    };
}

/**
 * Gives `listed.heading`, a heading listed from an earlier version of the document of `view`, an
 * id for the link that its pick inserts: the marker waits for that link. `from` and `to` are its
 * ends, mapped through the changes since, which must still hold `listed.text`, its source as
 * listed. Returns the id, or `undefined` with a toast when the heading was changed or replaced,
 * or takes no id.
 */
function markHeading(
    view: VanillaCodeMirror,
    listed: { heading: MarkdownHeading; text: string },
    from?: number,
    to?: number
) {
    const { doc } = view.state;
    const decline = (message: string) => {
        pendingMarkers.set(view, { doc, change: null });
        toast.showError(message);
        return undefined;
    };
    if (from === undefined || to === undefined || to < from
        || doc.sliceString(from, to) !== listed.text) {
        return decline(t("add_link.listing_changed"));
    }

    const source = doc.toString();
    const index = indexMarkdownBlocks(source, PREVIEW_BLOCK_HOST);
    const lineStart = doc.lineAt(from).from;
    const heading = findMarkdownHeadings(index).find(({ block }) => block.from === lineStart);
    if (heading?.title !== listed.heading.title) {
        return decline(t("add_link.listing_changed"));
    }
    if (heading.id !== undefined) {
        return heading.id;
    }

    const placed = placeMarkerOnBlock(source, index, heading.block, {
        kind: "draw", createId: generateBlockId
    }, PREVIEW_BLOCK_HOST);
    if (!placed?.change) {
        return decline(t("add_link.heading_reference_failed"));
    }
    pendingMarkers.set(view, { doc, change: placed.change });
    return placed.id;
}

function takePendingMarker(view: VanillaCodeMirror) {
    const pending = pendingMarkers.get(view);
    pendingMarkers.delete(view);
    return pending?.doc === view.state.doc ? pending.change : undefined;
}
//#endregion

//#region Menu of a marker
/** Opens the menu of the chip `element` of `marker`: copy a reference to its block, remove it. */
function openMarkerMenu(view: VanillaCodeMirror, marker: FoundBlockId, element: HTMLElement) {
    const { left, bottom } = element.getBoundingClientRect();
    const isEffective = !element.classList.contains("inert");
    contextMenu.show<CommandNames>({
        x: left,
        y: bottom,
        items: [
            {
                title: t("block_reference.copy_reference"),
                uiIcon: "bx bx-link",
                enabled: isEffective && sources.has(view),
                handler: () => copyMarkerReference(view, marker)
            },
            {
                title: t("block_reference.remove_reference"),
                uiIcon: "bx bx-unlink",
                enabled: !view.state.readOnly,
                handler: () => removeMarker(view, marker)
            }
        ],
        selectMenuItemHandler: () => {}
    });
}

function copyMarkerReference(view: VanillaCodeMirror, marker: FoundBlockId) {
    const index = indexMarkdownBlocks(view.state.doc.toString(), PREVIEW_BLOCK_HOST);
    const block = index.blocks.find((candidate) => candidate.marker?.from === marker.from);
    if (block) {
        void copyMarkdownReference(view, block, block);
    }
}

/**
 * Removes `marker`: an inline marker with the white space in front of it, a marker line with the
 * blank line after it.
 */
function removeMarker(view: VanillaCodeMirror, marker: FoundBlockId) {
    const { doc } = view.state;
    const line = doc.lineAt(marker.from);
    const before = line.text.slice(0, marker.from - line.from);
    const isMarkerLine = /^[\s>]*$/.test(before) && !line.text.slice(marker.to - line.from).trim();
    if (!isMarkerLine) {
        const spaces = before.length - before.trimEnd().length;
        view.dispatch({
            changes: { from: marker.from - spaces, to: marker.to }, userEvent: "delete"
        });
        return;
    }

    const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
    const removedTo = next && /^[\s>]*$/.test(next.text) && next.number < doc.lines
        ? next.to + 1
        : Math.min(line.to + 1, doc.length);
    const removedFrom = removedTo === line.to ? Math.max(0, line.from - 1) : line.from;
    view.dispatch({ changes: { from: removedFrom, to: removedTo }, userEvent: "delete" });
}
//#endregion

/** The only heading of `source` that can be linked and whose block starts on `line`. */
function findHeadingOnLine(source: string, line: number) {
    const onLine = findMarkdownHeadings(indexMarkdownBlocks(source, PREVIEW_BLOCK_HOST))
        .filter(({ block }) => block.startLine === line);
    return onLine.length === 1 ? onLine[0] : null;
}

/** The block of `index` at the place of `block`, a block of an index of the same document. */
function findSameBlock(index: MarkdownBlockIndex, block: IndexedBlock) {
    return index.blocks.find((candidate) =>
        candidate.from === block.from && isSameBlockKey(candidate.key, block.key));
}

/** `source` with `changes`, all on `source` and apart from each other, applied. */
function applyChanges(source: string, changes: SourceChange[]) {
    let result = source;
    for (const change of [ ...changes ].sort((a, b) => b.from - a.from)) {
        result = applySourceChange(result, change);
    }
    return result;
}

function drawAnotherId(id: string) {
    let other = generateBlockId();
    while (other === id) {
        other = generateBlockId();
    }
    return other;
}

/**
 * Saves the note `noteId` of `source` and tells whether the saved content gives both ends of
 * `range` to blocks: a reference copied before that would point at nothing.
 */
async function saveIds(
    source: MarkdownReferenceSource,
    noteId: string,
    range: { startId: string; endId: string }
) {
    let content: string | undefined;
    if (source.save) {
        content = await source.save();
    } else {
        await appContext.triggerEvent("saveNoteChanges", { noteId });
        content = noteSavedDataStore.get(noteId);
    }
    const saved = indexMarkdownBlocks(content ?? "", PREVIEW_BLOCK_HOST);
    return !!saved.resolve(range.startId) && !!saved.resolve(range.endId);
}
