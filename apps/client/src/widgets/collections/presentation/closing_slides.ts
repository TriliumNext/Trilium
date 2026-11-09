import { useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { PresentationSlideBaseModel, renderSlideContent } from "./model";

export type SlideContent = PresentationSlideBaseModel["content"];

/** An editor of a text slide that went away, while its last save runs. */
interface ClosingSlide {
    isSaving: boolean;
}

/**
 * Keeps the content of each text slide as its editor held it when it closed, rendered, until a
 * model built after the last save of the editor holds what the save stored. After a failed save,
 * the content stays until the next model. `refresh` builds the model again once a save succeeds.
 */
export function useClosingSlides(refresh: () => void) {
    const [ contents, setContents ] = useState<Record<string, SlideContent>>({});
    const closingRef = useRef(new Map<string, ClosingSlide>());

    function onEditorClose(slideNote: FNote, content: string, save: Promise<boolean>) {
        const { noteId } = slideNote;
        const closing: ClosingSlide = { isSaving: true };
        closingRef.current.set(noteId, closing);
        void renderSlideContent(slideNote, content).then((rendered) => {
            if (closingRef.current.get(noteId) === closing) {
                setContents((current) => ({ ...current, [noteId]: rendered }));
            }
        });
        void save.then((isSaved) => {
            if (closingRef.current.get(noteId) !== closing) return;
            closing.isSaving = false;
            if (isSaved) refresh();
        });
    }

    /** Returns the closed editors whose save has landed, which a model built from now reflects. */
    function getSaved() {
        return [ ...closingRef.current ].filter(([ , closing ]) => !closing.isSaving);
    }

    /** Drops the content of the editors that `getSaved()` returned, once a later model applies. */
    function release(saved: [string, ClosingSlide][]) {
        const released = saved.filter(([ noteId, closing ]) => (
            closingRef.current.get(noteId) === closing
        ));
        if (!released.length) return;
        for (const [ noteId ] of released) closingRef.current.delete(noteId);
        setContents((current) => {
            const next = { ...current };
            for (const [ noteId ] of released) delete next[noteId];
            return next;
        });
    }

    return { contents, onEditorClose, getSaved, release };
}
