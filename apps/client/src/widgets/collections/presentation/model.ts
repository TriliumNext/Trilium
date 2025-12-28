import { NoteType } from "@triliumnext/commons";
import FNote from "../../../entities/fnote";
import contentRenderer from "../../../services/content_renderer";
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
}

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
        const verticalSlides = note.type !== "search" ? await buildVerticalSlides(slideNote) : undefined;
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
    const slideBackground = note.getLabelValue("slide:background") ?? undefined;
    const isGradient = slideBackground?.includes("gradient(");

    return {
        noteId: note.noteId,
        type: note.type,
        content: await processContent(note),
        backgroundColor: !isGradient ? slideBackground : undefined,
        backgroundGradient: isGradient ? slideBackground : undefined
    }
}

async function processContent(note: FNote): Promise<DangerouslySetInnerHTML> {
    const { $renderedContent } = await contentRenderer.getRenderedContent(note, {
        noChildrenList: true
    });
    return { __html: $renderedContent.html() };
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
