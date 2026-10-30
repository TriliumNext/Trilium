import { useEffect, useState } from "preact/hooks";
import type { RevealApi } from "reveal.js";

import { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import ColorPicker from "../../react/ColorPicker";
import Dropdown, { DropdownPanel } from "../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../react/FormList";
import { useNoteLabel } from "../../react/hooks";
import { getNewSlideTypes, type NewSlideTypeOption, type PresentationSlideBaseModel } from "./model";
import { getNoteIdFromSlide } from "./reveal";

interface PresentationToolbarActionsProps {
    onStartPresentation(): void;
    api: RevealApi | undefined;
    /** Whether there are slides; the buttons that act on one are disabled otherwise. */
    hasSlides: boolean;
    isReadOnly: boolean;
    isEditing: boolean;
    onFinishEditing(): void;
    /** Adds a slide of a type after the one being shown; left out when slides cannot be added. */
    onNewSlide: ((type: NewSlideTypeOption) => void) | undefined;
    /** The slide being shown, for its background; left out when slides cannot be edited. */
    backgroundSlide: { slide: PresentationSlideBaseModel | undefined } | undefined;
}

/** The presentation's actions on the right of the collection's toolbar. */
export default function PresentationToolbarActions({
    onStartPresentation, api, hasSlides, isReadOnly, isEditing, onFinishEditing, onNewSlide, backgroundSlide
}: PresentationToolbarActionsProps) {
    const [ isOverviewActive, setIsOverviewActive ] = useState(false);
    useEffect(() => {
        if (!api) return;
        setIsOverviewActive(api.isOverview());
        const onEnabled = () => setIsOverviewActive(true);
        const onDisabled = () => setIsOverviewActive(false);
        api.on("overviewshown", onEnabled);
        api.on("overviewhidden", onDisabled);
        return () => {
            api.off("overviewshown", onEnabled);
            api.off("overviewhidden", onDisabled);
        };
    }, [ api ]);

    return (
        <>
            {onNewSlide && (
                <div className="icon-action-split presentation-new-slide">
                    <ActionButton
                        icon="bx bx-plus"
                        text={t("presentation_view.new-slide")}
                        onClick={() => onNewSlide(getNewSlideTypes()[0][0])}
                    />
                    <Dropdown
                        buttonClassName="bx bx-chevron-down"
                        buttonProps={{ "aria-label": t("split_button.more_actions") }}
                        iconAction
                        hideToggleArrow
                        noSelectButtonStyle
                        title={t("split_button.more_actions")}
                        placement="bottom-end"
                        mobileBottomSheet
                    >
                        <NewSlideTypeItems onNewSlide={onNewSlide} />
                    </Dropdown>
                </div>
            )}

            {isEditing && (
                <ActionButton
                    icon="bx bx-check"
                    text={t("presentation_view.finish-editing")}
                    shortcut="Escape"
                    onClick={onFinishEditing}
                />
            )}

            {!isReadOnly && (
                <ActionButton
                    icon="bx bx-edit"
                    text={t("presentation_view.edit-slide")}
                    disabled={!hasSlides}
                    onClick={e => {
                        const currentSlide = api?.getCurrentSlide();
                        const noteId = getNoteIdFromSlide(currentSlide);

                        if (noteId) {
                            openInCurrentNoteContext(e, noteId);
                        }
                    }}
                />
            )}

            {backgroundSlide && <SlideBackgroundAction slide={backgroundSlide.slide} />}

            <ActionButton
                icon="bx bx-grid-horizontal"
                text={t("presentation_view.slide-overview")}
                shortcut="O"
                active={isOverviewActive}
                disabled={!hasSlides}
                onClick={() => api?.toggleOverview()}
            />

            <ActionButton
                icon="bx bx-fullscreen"
                text={t("presentation_view.start-presentation")}
                shortcut="F"
                disabled={!hasSlides}
                onClick={onStartPresentation}
            />
        </>
    );
}

/**
 * The menu rows of the kinds of note a new slide can be, each adding a slide of its kind, with the
 * slides edited in place first.
 */
export function NewSlideTypeItems({ onNewSlide }: { onNewSlide(type: NewSlideTypeOption): void }) {
    return getNewSlideTypes().map((group, index) => [
        index > 0 && <FormDropdownDivider key={`divider-${index}`} />,
        ...group.map((option) => (
            <FormListItem key={option.type} icon={option.icon} onClick={() => onNewSlide(option)}>
                {option.title}
            </FormListItem>
        ))
    ]);
}

/**
 * The toggle of the slide sidebar, on the left of the collection's toolbar. It is disabled, and shows
 * the sidebar as hidden, while there are no slides to list.
 */
export function SlideSidebarToggle({ isVisible, hasSlides, onToggle }: {
    isVisible: boolean;
    hasSlides: boolean;
    onToggle(): void;
}) {
    return (
        <ActionButton
            icon="bx bx-sidebar"
            text={t("presentation_view.slide-sidebar")}
            active={isVisible && hasSlides}
            disabled={!hasSlides}
            onClick={onToggle}
        />
    );
}

/**
 * The control for the background color of the slide being shown, a color picker in a dropdown. It is
 * disabled for a slide that {@link canPickSlideBackground} rules out.
 */
function SlideBackgroundAction({ slide }: { slide: PresentationSlideBaseModel | undefined }) {
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
