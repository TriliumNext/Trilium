import { NoteType } from "@triliumnext/commons";
import FNote from "../../../entities/fnote";
import contentRenderer, { snapshotAndDispose } from "../../../services/content_renderer";
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
        backgroundColor: !isGradient ? slideBackground : undefined,
        backgroundGradient: isGradient ? slideBackground : undefined
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
    const { $renderedContent } = await contentRenderer.getRenderedContent(note, {
        noChildrenList: true,
        mediaEnvironment: "native"
    });
    return { __html: sanitizeNoteContentHtml(snapshotAndDispose($renderedContent)) };
}

async function postProcessSlides(slides: (PresentationSlideModel | PresentationSlideBaseModel)[]) {
    for (const slide of slides) {
        if (slide.type !== "text") continue;
        slide.content.__html = slide.content.__html.replaceAll(/href="[^"]*#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)[^"]*"/g, `href="#/slide-$1"`);
        if ("verticalSlides" in slide && slide.verticalSlides) {
            postProcessSlides(slide.verticalSlides);
        }
    }
}
