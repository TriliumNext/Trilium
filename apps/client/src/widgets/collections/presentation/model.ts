import { NoteType } from "@triliumnext/commons";
import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import contentRenderer, { snapshotAndDispose } from "../../../services/content_renderer";
import { renderTextContent } from "../../../services/content_renderer_text";
import froca from "../../../services/froca";
import note_create from "../../../services/note_create";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
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
 * Creates an empty text slide after the slide of `currentNoteId`, at its level, or as the last slide
 * when no slide is shown. Returns the ID of the new note.
 */
export async function createSlide(presentation: PresentationModel, collectionNoteId: string, currentNoteId: string | undefined) {
    const { parentNoteId, afterNoteId } = getNewSlidePosition(presentation, collectionNoteId, currentNoteId);
    const targetBranchId = afterNoteId ? await froca.getBranchId(parentNoteId, afterNoteId) : null;
    const { note } = await note_create.createNote(parentNoteId, {
        type: "text",
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
export function getNewSlidePosition(presentation: PresentationModel, collectionNoteId: string, currentNoteId: string | undefined) {
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

/** A slide dropped before or after another slide at its level. */
export interface SlideMove {
    noteId: string;
    targetNoteId: string;
    position: "before" | "after";
}

/**
 * Returns the move of the slide `noteId` before or after the slide `targetNoteId`, if both have the
 * same parent, the move changes the order, and the parent's children are not sorted by `#sorted`.
 */
export function getSlideMove(
    presentation: PresentationModel, collectionNoteId: string, noteId: string, targetNoteId: string,
    position: SlideMove["position"], isSorted: (parentNoteId: string) => boolean
): SlideMove | undefined {
    const level = findSlideLevel(presentation, collectionNoteId, noteId);
    if (!level || noteId === targetNoteId || isSorted(level.parentNoteId)) return;

    const from = level.slides.findIndex(slide => slide.noteId === noteId);
    const to = level.slides.findIndex(slide => slide.noteId === targetNoteId);
    if (to < 0) return;
    const insertion = position === "before" ? to : to + 1;
    if (insertion === from || insertion === from + 1) return;
    return { noteId, targetNoteId, position };
}

/** Returns the model with `move` applied, so that the sidebar and the slides show it before the server does. */
export function applySlideMove(presentation: PresentationModel, move: SlideMove): PresentationModel {
    function reorder<T extends PresentationSlideBaseModel>(slides: T[]) {
        const moved = slides.find(slide => slide.noteId === move.noteId);
        if (!moved || !slides.some(slide => slide.noteId === move.targetNoteId)) return slides;
        const rest = slides.filter(slide => slide !== moved);
        const target = rest.findIndex(slide => slide.noteId === move.targetNoteId);
        rest.splice(move.position === "before" ? target : target + 1, 0, moved);
        return rest;
    }

    return {
        slides: reorder(presentation.slides).map(slide => (
            slide.verticalSlides ? { ...slide, verticalSlides: reorder(slide.verticalSlides) } : slide
        ))
    };
}

/**
 * Moves the branch of the slide's note before or after the target's branch, under their parent. Returns
 * whether it found both branches; a move the server refuses shows a toast but still returns `true`.
 */
export async function moveSlideNote(presentation: PresentationModel, collectionNoteId: string, move: SlideMove) {
    const level = findSlideLevel(presentation, collectionNoteId, move.noteId);
    if (!level) return false;
    const [ branchId, targetBranchId ] = await Promise.all([
        froca.getBranchId(level.parentNoteId, move.noteId),
        froca.getBranchId(level.parentNoteId, move.targetNoteId)
    ]);
    if (!branchId || !targetBranchId) return false;

    if (move.position === "before") {
        await branches.moveBeforeBranch([ branchId ], targetBranchId);
    } else {
        await branches.moveAfterBranch([ branchId ], targetBranchId);
    }
    return true;
}

/** Returns the slides at the level of the slide `noteId`, with the note they are children of. */
function findSlideLevel(presentation: PresentationModel, collectionNoteId: string, noteId: string) {
    if (presentation.slides.some(slide => slide.noteId === noteId)) {
        return { parentNoteId: collectionNoteId, slides: presentation.slides as PresentationSlideBaseModel[] };
    }
    for (const slide of presentation.slides) {
        if (slide.verticalSlides?.some(verticalSlide => verticalSlide.noteId === noteId)) {
            return { parentNoteId: slide.noteId, slides: slide.verticalSlides };
        }
    }
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
