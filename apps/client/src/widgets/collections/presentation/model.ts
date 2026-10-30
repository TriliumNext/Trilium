import { getCodeLanguageIcon, NOTE_TYPE_ICONS, NoteType } from "@triliumnext/commons";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import contentRenderer, { snapshotAndDispose } from "../../../services/content_renderer";
import { renderTextContent } from "../../../services/content_renderer_text";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import mimeTypes from "../../../services/mime_types";
import note_create from "../../../services/note_create";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { ProgressChangedFn } from "../interface";

type DangerouslySetInnerHTML = { __html: string; };

/** A top-level slide with optional vertical slides. */
interface PresentationSlideModel extends PresentationSlideBaseModel {
    verticalSlides: PresentationSlideBaseModel[] | undefined;
}

/** Either a top-level slide or a vertical slide. */
export interface PresentationSlideBaseModel {
    noteId: string;
    type: NoteType;
    content: DangerouslySetInnerHTML;
    backgroundColor?: string;
    backgroundGradient?: string;
    /** The page a web view slide shows, across the whole slide. */
    webViewSrc?: string;
    /** Whether the slide shows its note's collection live, with the app's own view, across the whole slide. */
    isCollection?: boolean;
    /** Whether the slide's note has `#readOnly`, so that it cannot be edited in place. */
    isReadOnly?: boolean;
}

/**
 * The view types of the collections that a slide shows live. A collection with another view type stays a
 * slide of its own content whose child notes are its vertical slides.
 */
const COLLECTION_SLIDE_VIEW_TYPES = new Set([ "board", "table" ]);

export interface PresentationModel {
    slides: PresentationSlideModel[];
}

export async function buildPresentationModel(note: FNote, onProgressChanged?: ProgressChangedFn): Promise<PresentationModel> {
    const slideNotes = await note.getChildNotes();
    onProgressChanged?.(0.3);
    const total = slideNotes.length;
    let completed = 0;

    const slidePromises = slideNotes.map(slideNote => (async () => {
        const base = await buildSlideModel(slideNote);
        // The child notes of a collection slide are what its collection shows.
        const verticalSlides = note.type !== "search" && !base.isCollection ? await buildVerticalSlides(slideNote) : undefined;
        const slide: PresentationSlideModel = { ...base, verticalSlides };
        completed++;
        onProgressChanged?.(Math.min(0.3 + (completed / total) * 0.4, 0.7));
        return slide;
    })());

    const slides: PresentationSlideModel[] = await Promise.all(slidePromises);

    onProgressChanged?.(0.7);
    postProcessSlides(slides);
    onProgressChanged?.(1);
    return { slides };
}

async function buildVerticalSlides(parentSlideNote: FNote): Promise<undefined | PresentationSlideBaseModel[]> {
    const children = await parentSlideNote.getChildNotes();
    if (!children.length) return;

    const slides: PresentationSlideBaseModel[] = await Promise.all(children.map(buildSlideModel));

    return slides;
}

async function buildSlideModel(note: FNote): Promise<PresentationSlideBaseModel> {
    if (note.type === "webView") {
        return {
            noteId: note.noteId,
            type: note.type,
            content: { __html: "" },
            webViewSrc: getWebViewSrc(note)
        };
    }

    const slideBackground = note.getLabelValue("slide:background") ?? undefined;
    const isGradient = slideBackground?.includes("gradient(");
    const isCollection = isCollectionSlide(note);

    return {
        noteId: note.noteId,
        type: note.type,
        content: isCollection ? { __html: "" } : await processContent(note),
        isCollection: isCollection || undefined,
        isReadOnly: note.isLabelTruthy("readOnly") || undefined,
        backgroundColor: !isGradient ? slideBackground : undefined,
        backgroundGradient: isGradient ? slideBackground : undefined
    }
}

/**
 * Whether `slide` can be edited in place: a text or canvas slide in its editor on the slide, a board
 * or table slide in its own view. A slide whose note is read-only cannot.
 */
export function canEditSlideInPlace(slide: PresentationSlideBaseModel) {
    return (slide.type === "text" || slide.type === "canvas" || !!slide.isCollection) && !slide.isReadOnly;
}

/** The kinds of note a new slide can be, with what each note is created with. */
const NEW_SLIDE_NOTES = {
    text: { type: "text", mime: "text/html" },
    canvas: { type: "canvas", mime: "application/json" },
    board: { type: "book", templateNoteId: "_template_board" },
    table: { type: "book", templateNoteId: "_template_table" },
    mermaid: { type: "mermaid", mime: "text/mermaid" },
    webView: { type: "webView", mime: "" },
    code: { type: "code", mime: "text/plain" },
    spreadsheet: { type: "spreadsheet", mime: "application/json" }
} satisfies Record<string, { type: NoteType; mime?: string; templateNoteId?: string }>;

export type NewSlideType = keyof typeof NEW_SLIDE_NOTES;

export interface NewSlideTypeOption {
    type: NewSlideType;
    title: string;
    icon: string;
    /**
     * How a new slide of the type starts editing: in place, as `Slide` edits it, or in quick edit.
     * Left out for a slide that is only shown.
     */
    startsEditing: "inPlace" | "quickEdit" | undefined;
    /** The MIME type of the note, over the one that the type is created with. */
    mime?: string;
    /** The options that a slide of the type is created from instead, such as the code languages. */
    languages?: NewSlideTypeOption[];
}

/**
 * Returns the kinds of note a new slide can be, in the groups that the menus which create slides
 * show apart: the text and canvas slides edited in place, then the other kinds that a slide shows.
 */
export function getNewSlideTypes(): NewSlideTypeOption[][] {
    return [
        [
            { type: "text", title: t("note_types.text"), icon: "bx bx-note", startsEditing: "inPlace" },
            { type: "canvas", title: t("note_types.canvas"), icon: NOTE_TYPE_ICONS.canvas, startsEditing: "inPlace" }
        ],
        [
            { type: "board", title: t("book_properties.board"), icon: "bx bx-columns", startsEditing: "inPlace" },
            { type: "table", title: t("book_properties.table"), icon: "bx bx-table", startsEditing: "inPlace" },
            // A new diagram or code shows nothing, so its source is written at once.
            {
                type: "mermaid", title: t("note_types.mermaid-diagram"), icon: NOTE_TYPE_ICONS.mermaid,
                startsEditing: "quickEdit"
            },
            {
                type: "webView", title: t("note_types.web-view"), icon: NOTE_TYPE_ICONS.webView,
                startsEditing: undefined
            },
            {
                type: "code", title: t("note_types.code"), icon: NOTE_TYPE_ICONS.code, startsEditing: "quickEdit",
                languages: getCodeLanguages()
            },
            {
                type: "spreadsheet", title: t("note_types.spreadsheet"), icon: NOTE_TYPE_ICONS.spreadsheet,
                startsEditing: undefined
            }
        ]
    ];
}

/**
 * Returns a code slide in each code language that the code note options enable, in their order, as
 * the app's note type menus offer them. The options are read again each time, so a language enabled
 * since the last menu is offered.
 */
function getCodeLanguages(): NewSlideTypeOption[] {
    mimeTypes.loadMimeTypes();
    return mimeTypes.getEnabledMimeTypes().map((mimeType) => ({
        type: "code",
        title: mimeType.title,
        icon: getCodeLanguageIcon(mimeType),
        startsEditing: "quickEdit",
        mime: mimeType.mime
    }));
}

/**
 * Creates an empty slide of `type` at `position`, from `getNewSlidePosition()` or
 * `getNewVerticalSlidePosition()`, with `mime` over the MIME type of the type. Returns the ID of
 * the new note.
 */
export async function createSlide(
    { parentNoteId, afterNoteId }: NewSlidePosition, type: NewSlideType = "text", mime?: string
) {
    const targetBranchId = afterNoteId ? await froca.getBranchId(parentNoteId, afterNoteId) : null;
    const { note } = await note_create.createNote(parentNoteId, {
        ...NEW_SLIDE_NOTES[type],
        ...(mime ? { mime } : {}),
        activate: false,
        isProtected: froca.getNoteFromCache(parentNoteId)?.isProtected,
        ...(targetBranchId ? { target: "after", targetBranchId } : {})
    });
    return note?.noteId;
}

/**
 * Returns where a new slide goes: after the top-level slide `currentNoteId`, past its vertical slides,
 * or after the vertical slide `currentNoteId` among its siblings. Without a current slide, the new
 * slide goes at the end of the presentation.
 */
export function getNewSlidePosition(
    presentation: PresentationModel, collectionNoteId: string, currentNoteId: string | undefined
): NewSlidePosition {
    for (const slide of presentation.slides) {
        if (slide.noteId === currentNoteId) {
            return { parentNoteId: collectionNoteId, afterNoteId: currentNoteId };
        }
        if (slide.verticalSlides?.some(verticalSlide => verticalSlide.noteId === currentNoteId)) {
            return { parentNoteId: slide.noteId, afterNoteId: currentNoteId };
        }
    }
    return { parentNoteId: collectionNoteId, afterNoteId: undefined };
}

/** Where a new slide goes: under `parentNoteId`, after `afterNoteId` or as its last child. */
export interface NewSlidePosition {
    parentNoteId: string;
    afterNoteId: string | undefined;
}

/** Returns where a new vertical slide of the top-level slide `noteId` goes: after its last vertical slide. */
export function getNewVerticalSlidePosition(presentation: PresentationModel, noteId: string): NewSlidePosition {
    const slide = presentation.slides.find(topLevel => topLevel.noteId === noteId);
    return { parentNoteId: noteId, afterNoteId: slide?.verticalSlides?.at(-1)?.noteId };
}

/**
 * Duplicates the slide `noteId` with its vertical slides, and places the copy right after it. Unlike
 * `note_create.duplicateSubtree()`, it does not open the copy, which would leave the presentation.
 * Returns the ID of the copy.
 */
export async function duplicateSlide(presentation: PresentationModel, collectionNoteId: string, noteId: string) {
    const parentNoteId = getSlideParentNoteId(presentation, collectionNoteId, noteId);
    const branchId = parentNoteId && await froca.getBranchId(parentNoteId, noteId);
    if (!parentNoteId || !branchId) return;

    const { note, branch } = await server.post<{ note: { noteId: string }, branch: { branchId: string } }>(
        `notes/${noteId}/duplicate/${parentNoteId}`);
    await ws.waitForMaxKnownEntityChangeId();
    await branches.moveAfterBranch([ branch.branchId ], branchId);
    return note.noteId;
}

/**
 * Deletes the slide `noteId` through the delete dialog, without leaving the presentation. Returns
 * whether the slide was deleted, rather than the dialog canceled.
 */
export async function deleteSlide(presentation: PresentationModel, collectionNoteId: string, noteId: string) {
    const parentNoteId = getSlideParentNoteId(presentation, collectionNoteId, noteId);
    const branchId = parentNoteId && await froca.getBranchId(parentNoteId, noteId);
    return branchId ? await branches.deleteNotes([ branchId ], false, false) : false;
}

/** Returns the note that the slide `noteId` is a child of: the collection, or its top-level slide. */
export function getSlideParentNoteId(presentation: PresentationModel, collectionNoteId: string, noteId: string) {
    const ordered = getSlideOrder(presentation).find(({ slide }) => slide.noteId === noteId);
    return ordered && (ordered.stack?.noteId ?? collectionNoteId);
}

/**
 * A slide dropped next to another slide, or as the first vertical slide of a top-level slide without any.
 * A slide next to a slide under another parent moves to that parent, so a move can change its level.
 */
export interface SlideMove {
    noteId: string;
    targetNoteId: string;
    position: "before" | "after" | "into";
}

/** A slide in sidebar order, with the top-level slide whose vertical slide it is. */
interface OrderedSlide {
    slide: PresentationSlideModel | PresentationSlideBaseModel;
    stack?: PresentationSlideModel;
}

/**
 * Returns the move of the slide `noteId` dropped into the gap before the slide at `gap` in sidebar
 * order (the end past the last). The slide keeps its level unless `levelShift` makes it a vertical slide
 * (`1`) or a top-level one (`-1`). A top-level slide goes before the next top-level slide, past any
 * vertical slides; a vertical slide goes after the slide above the gap, or becomes the first vertical
 * slide of a top-level slide without any.
 *
 * Returns nothing for a drop that changes nothing, a slide with vertical slides of its own made vertical,
 * a slide placed under a board or table slide, or under a note whose children are sorted by `#sorted`.
 */
export function getSlideMove(
    presentation: PresentationModel, collectionNoteId: string, noteId: string, gap: number,
    levelShift: -1 | 0 | 1, isSorted: (parentNoteId: string) => boolean
): SlideMove | undefined {
    const order = getSlideOrder(presentation);
    const dragged = order.find(({ slide }) => slide.noteId === noteId);
    if (!dragged) return;
    const toVertical = levelShift > 0 || (levelShift === 0 && !!dragged.stack);

    let move: SlideMove | undefined;
    let parentNoteId = collectionNoteId;
    if (toVertical) {
        if (!dragged.stack && (dragged.slide as PresentationSlideModel).verticalSlides) return;
        const above = order[gap - 1];
        const below = order[gap];
        if (!above) return;
        if (above.stack) {
            move = { noteId, targetNoteId: above.slide.noteId, position: "after" };
            parentNoteId = above.stack.noteId;
        } else if (below?.stack === above.slide) {
            move = { noteId, targetNoteId: below.slide.noteId, position: "before" };
            parentNoteId = above.slide.noteId;
        } else {
            if (above.slide.isCollection) return;
            move = { noteId, targetNoteId: above.slide.noteId, position: "into" };
            parentNoteId = above.slide.noteId;
        }
    } else {
        const next = order.slice(gap).find(({ stack }) => !stack);
        const last = presentation.slides.at(-1);
        if (next) {
            move = { noteId, targetNoteId: next.slide.noteId, position: "before" };
        } else if (last) {
            move = { noteId, targetNoteId: last.noteId, position: "after" };
        }
    }

    if (!move || move.targetNoteId === noteId || isSorted(parentNoteId)) return;
    if (describeOrder(applySlideMove(presentation, move)) === describeOrder(presentation)) return;
    return move;
}

/** Returns the model with `move` applied, so that the sidebar and the slides show it before the server does. */
export function applySlideMove(presentation: PresentationModel, move: SlideMove): PresentationModel {
    let moved: PresentationSlideModel | PresentationSlideBaseModel | undefined;
    const slides: PresentationSlideModel[] = [];
    for (const slide of presentation.slides) {
        const movedVertical = slide.verticalSlides?.find(verticalSlide => verticalSlide.noteId === move.noteId);
        if (slide.noteId === move.noteId) {
            moved = slide;
        } else if (slide.verticalSlides && movedVertical) {
            moved = movedVertical;
            const verticalSlides = slide.verticalSlides.filter(verticalSlide => verticalSlide !== movedVertical);
            slides.push({ ...slide, verticalSlides: verticalSlides.length ? verticalSlides : undefined });
        } else {
            slides.push(slide);
        }
    }
    if (!moved) return presentation;

    const topLevelIndex = slides.findIndex(slide => slide.noteId === move.targetNoteId);
    if (move.position === "into") {
        const target = slides[topLevelIndex];
        if (!target) return presentation;
        slides[topLevelIndex] = { ...target, verticalSlides: [ ...target.verticalSlides ?? [], toVerticalSlide(moved) ] };
    } else if (topLevelIndex >= 0) {
        const topLevel = { ...moved, verticalSlides: (moved as PresentationSlideModel).verticalSlides };
        slides.splice(move.position === "before" ? topLevelIndex : topLevelIndex + 1, 0, topLevel);
    } else {
        const stackIndex = slides.findIndex(slide => (
            slide.verticalSlides?.some(verticalSlide => verticalSlide.noteId === move.targetNoteId)
        ));
        const stack = slides[stackIndex];
        if (!stack?.verticalSlides) return presentation;
        const verticalSlides = [ ...stack.verticalSlides ];
        const index = verticalSlides.findIndex(verticalSlide => verticalSlide.noteId === move.targetNoteId);
        verticalSlides.splice(move.position === "before" ? index : index + 1, 0, toVerticalSlide(moved));
        slides[stackIndex] = { ...stack, verticalSlides };
    }
    return { slides };
}

/**
 * Whether the move from `before` to `after` puts the slide `noteId` in a new `<section>`: it changes
 * parent, or gains or loses its vertical slides, so that an editor in its section goes away.
 */
export function isSlideRebuilt(before: PresentationModel, after: PresentationModel, noteId: string) {
    return describeSlide(before, noteId) !== describeSlide(after, noteId);
}

/**
 * Moves the branch of the slide's note next to the target's branch, under the target's parent, or under
 * the target for `into`. Returns whether it found both branches; a move the server refuses shows a
 * toast but still returns `true`.
 */
export async function moveSlideNote(presentation: PresentationModel, collectionNoteId: string, move: SlideMove) {
    const parentNoteId = getSlideParentNoteId(presentation, collectionNoteId, move.noteId);
    const targetParentNoteId = getSlideParentNoteId(presentation, collectionNoteId, move.targetNoteId);
    if (!parentNoteId || !targetParentNoteId) return false;
    const [ branchId, targetBranchId ] = await Promise.all([
        froca.getBranchId(parentNoteId, move.noteId),
        froca.getBranchId(targetParentNoteId, move.targetNoteId)
    ]);
    if (!branchId || !targetBranchId) return false;

    if (move.position === "into") {
        await branches.moveToParentNote([ branchId ], targetBranchId);
    } else if (move.position === "before") {
        await branches.moveBeforeBranch([ branchId ], targetBranchId);
    } else {
        await branches.moveAfterBranch([ branchId ], targetBranchId);
    }
    return true;
}

/** Returns the slides in sidebar order: each top-level slide, then its vertical slides. */
function getSlideOrder(presentation: PresentationModel): OrderedSlide[] {
    return presentation.slides.flatMap(slide => [
        { slide },
        ...slide.verticalSlides?.map(verticalSlide => ({ slide: verticalSlide, stack: slide })) ?? []
    ]);
}

function describeOrder(presentation: PresentationModel) {
    return presentation.slides.map(slide => [
        slide.noteId, ...slide.verticalSlides?.map(verticalSlide => verticalSlide.noteId) ?? []
    ].join(" ")).join("|");
}

function describeSlide(presentation: PresentationModel, noteId: string) {
    const ordered = getSlideOrder(presentation).find(({ slide }) => slide.noteId === noteId);
    if (!ordered) return;
    const hasStack = !ordered.stack && !!(ordered.slide as PresentationSlideModel).verticalSlides;
    return `${ordered.stack?.noteId ?? ""}/${hasStack}`;
}

function toVerticalSlide(slide: PresentationSlideModel | PresentationSlideBaseModel): PresentationSlideBaseModel {
    const verticalSlide: Partial<PresentationSlideModel> = { ...slide };
    delete verticalSlide.verticalSlides;
    return verticalSlide as PresentationSlideBaseModel;
}

/** Whether `note` is a collection that its slide shows live, see {@link COLLECTION_SLIDE_VIEW_TYPES}. */
export function isCollectionSlide(note: FNote) {
    return note.type === "book" && COLLECTION_SLIDE_VIEW_TYPES.has(note.getLabelValue("viewType") ?? "");
}

/**
 * Returns the `#webViewSrc` of a web view note if it is an `http:` or `https:` URL. Reveal.js frames the page
 * without a `sandbox`, so another protocol such as `javascript:` would run in the app's origin.
 */
function getWebViewSrc(note: FNote) {
    const src = note.getLabelValue("webViewSrc")?.trim();
    if (!src) return;

    try {
        const { protocol } = new URL(src);
        return protocol === "http:" || protocol === "https:" ? src : undefined;
    } catch {
        return undefined;
    }
}

async function processContent(note: FNote): Promise<DangerouslySetInnerHTML> {
    const { $renderedContent } =
        await contentRenderer.getRenderedContent(note, SLIDE_RENDER_OPTIONS);
    return { __html: sanitizeNoteContentHtml(snapshotAndDispose($renderedContent)) };
}

const SLIDE_RENDER_OPTIONS = {
    noChildrenList: true,
    mediaEnvironment: "native"
} as const;

/**
 * Renders `content`, the HTML of the text slide `note`, which can differ from the saved content,
 * as the editor of the slide holds it when it closes.
 */
export async function renderSlideContent(
    note: FNote,
    content: string
): Promise<DangerouslySetInnerHTML> {
    const $renderedContent = $("<div>");
    await renderTextContent(note, content, $renderedContent, SLIDE_RENDER_OPTIONS);
    const html = sanitizeNoteContentHtml(snapshotAndDispose($renderedContent));
    return { __html: rewriteSlideLinks(html) };
}

async function postProcessSlides(slides: (PresentationSlideModel | PresentationSlideBaseModel)[]) {
    for (const slide of slides) {
        if (slide.type !== "text") continue;
        slide.content.__html = rewriteSlideLinks(slide.content.__html);
        if ("verticalSlides" in slide && slide.verticalSlides) {
            postProcessSlides(slide.verticalSlides);
        }
    }
}

/** Points the links in `html` at the slides of the notes they link to. */
function rewriteSlideLinks(html: string) {
    return html.replaceAll(/href="[^"]*#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)[^"]*"/g, `href="#/slide-$1"`);
}
