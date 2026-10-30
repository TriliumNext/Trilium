import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import ColorPicker from "../../react/ColorPicker";
import { DropdownPanel } from "../../react/Dropdown";
import { useNoteLabel } from "../../react/hooks";
import type { PresentationSlideBaseModel } from "./model";

/**
 * The toolbar's control for the background color of the slide being shown, a color picker in a
 * dropdown. It is disabled for a slide that {@link canPickSlideBackground} rules out.
 */
export default function SlideBackgroundAction({ slide }: { slide: PresentationSlideBaseModel | undefined }) {
    const note = slide && canPickSlideBackground(slide) ? froca.getNoteFromCache(slide.noteId) : undefined;
    return (
        <DropdownPanel
            buttonClassName="bx bx-palette"
            title={t("presentation_view.slide-background")}
            iconAction
            hideToggleArrow
            disabled={!note}
        >
            {note && <SlideBackgroundPicker note={note} />}
        </DropdownPanel>
    );
}

/** Reads and writes `#slide:background` of `note`. A gradient selects no color, and a pick replaces it. */
export function SlideBackgroundPicker({ note }: { note: FNote }) {
    const [ background, setBackground ] = useNoteLabel(note, "slide:background");
    const isGradient = !!background?.includes("gradient(");
    return (
        <ColorPicker
            currentValue={background && !isGradient ? background : null}
            indeterminate={isGradient}
            onChange={(color) => void setBackground(color)}
        />
    );
}

/**
 * Whether the slide can take a background: a web view or a collection covers the whole slide, so
 * the background never shows, and a read-only slide cannot be changed.
 */
export function canPickSlideBackground(slide: PresentationSlideBaseModel | undefined) {
    return !!slide && !slide.webViewSrc && !slide.isCollection && !slide.isReadOnly;
}
