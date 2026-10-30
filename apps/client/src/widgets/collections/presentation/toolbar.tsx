import "./toolbar.css";

import clsx from "clsx";
import { useEffect, useState } from "preact/hooks";
import type { RevealApi } from "reveal.js";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import ColorPicker from "../../react/ColorPicker";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem } from "../../react/FormList";
import { useFullscreen, useNoteLabel } from "../../react/hooks";
import OverlayControlGroup, { OverlayControlButton, OverlayControlDropdown } from "../../react/OverlayControlGroup";
import {
    canEditSlideInPlace, getNewSlideTypes, type NewSlideTypeOption, type PresentationSlideBaseModel
} from "./model";

/** The name of the `<slot>` in the stage's shadow tree that shows {@link PresentationControls}. */
export const CONTROLS_SLOT_NAME = "presentation-controls";

/** How long the pointer rests in full-screen before the controls fade out, in milliseconds. */
const IDLE_DELAY = 3000;

interface PresentationControlsProps {
    api: RevealApi | undefined;
    /** The shadow host that holds the slides; it is the element that goes full-screen. */
    stage: HTMLElement;
    /** Every slide, vertical ones after their parent, in the order that previous and next follow. */
    slideNoteIds: string[];
    activeNoteId: string | undefined;
    isEditing: boolean;
    onFinishEditing(): void;
    /** Adds a slide of a type after the one being shown; left out when slides cannot be added. */
    onNewSlide: ((type: NewSlideTypeOption) => void) | undefined;
    /** The slide being shown, for its background; left out when slides cannot be edited. */
    backgroundSlide: { slide: PresentationSlideBaseModel | undefined } | undefined;
    /**
     * The slide being shown, for the edit button, which edits it in place with `onEditInPlace` where
     * it can be, and in quick edit otherwise; left out when the presentation is read-only.
     */
    slideToEdit: {
        slide: PresentationSlideBaseModel | undefined;
        onEditInPlace: ((noteId: string) => void) | undefined;
    } | undefined;
}

/**
 * The controls at the foot of the stage, rendered into the stage's {@link CONTROLS_SLOT_NAME} slot so
 * that they go full-screen with it: the editing controls at the start, and the navigation at the end.
 * Full-screen shows the navigation alone, and fades it out while the pointer rests.
 */
export default function PresentationControls({
    api, stage, slideNoteIds, activeNoteId, isEditing, onFinishEditing, onNewSlide, backgroundSlide, slideToEdit
}: PresentationControlsProps) {
    const [ isFullscreen, toggleFullscreen ] = useFullscreen(stage);
    const isIdle = useIsPointerIdle(isFullscreen ? stage : null);
    const isOverviewActive = useIsOverviewActive(api);
    const index = activeNoteId ? slideNoteIds.indexOf(activeNoteId) : -1;

    return (
        <div slot={CONTROLS_SLOT_NAME} className={clsx("presentation-controls", isIdle && "is-idle")}>
            {!isFullscreen && (onNewSlide || slideToEdit || backgroundSlide) && (
                <OverlayControlGroup className="presentation-edit-controls" placement="bottom-start">
                    {onNewSlide && <>
                        <OverlayControlButton
                            icon="bx-plus"
                            text={t("presentation_view.new-slide")}
                            className="presentation-new-slide"
                            onClick={() => onNewSlide(getNewSlideTypes()[0][0])}
                        />
                        <OverlayControlDropdown
                            title={t("split_button.more_actions")}
                            icon="bx-chevron-down"
                            mobileBottomSheet
                        >
                            <NewSlideTypeItems onNewSlide={onNewSlide} />
                        </OverlayControlDropdown>
                    </>}
                    {slideToEdit && <OverlayControlButton
                        title={isEditing ? t("presentation_view.finish-editing") : t("presentation_view.edit-slide")}
                        icon={isEditing ? "bx-check" : "bx-edit"}
                        active={isEditing}
                        shortcut={isEditing ? "Escape" : undefined}
                        disabled={!isEditing && !slideToEdit.slide}
                        onClick={isEditing ? onFinishEditing : () => editSlide(slideToEdit)}
                    />}
                    {backgroundSlide && <SlideBackgroundAction slide={backgroundSlide.slide} />}
                </OverlayControlGroup>
            )}

            <OverlayControlGroup className="presentation-navigation" placement="bottom-end">
                <OverlayControlButton
                    title={t("presentation_view.previous-slide")}
                    icon="bx-chevron-left"
                    shortcut="Shift+Space"
                    disabled={index <= 0}
                    onClick={() => api?.prev()}
                />
                <span className="presentation-slide-counter">
                    {index >= 0 && t("presentation_view.slide-counter", {
                        current: index + 1, total: slideNoteIds.length
                    })}
                </span>
                <OverlayControlButton
                    title={t("presentation_view.next-slide")}
                    icon="bx-chevron-right"
                    shortcut="Space"
                    disabled={index < 0 || index >= slideNoteIds.length - 1}
                    onClick={() => api?.next()}
                />
                <OverlayControlButton
                    title={t("presentation_view.slide-overview")}
                    icon="bx-grid-horizontal"
                    shortcut="O"
                    active={isOverviewActive}
                    onClick={() => api?.toggleOverview()}
                />
                <OverlayControlButton
                    title={isFullscreen ? t("common.exit_fullscreen") : t("presentation_view.start-presentation")}
                    icon={isFullscreen ? "bx-exit-fullscreen" : "bx-fullscreen"}
                    shortcut={isFullscreen ? "Escape" : "F"}
                    onClick={() => void toggleFullscreen()}
                />
            </OverlayControlGroup>
        </div>
    );
}

function editSlide({ slide, onEditInPlace }: NonNullable<PresentationControlsProps["slideToEdit"]>) {
    if (!slide) return;
    if (onEditInPlace && canEditSlideInPlace(slide)) {
        onEditInPlace(slide.noteId);
    } else {
        void appContext.triggerCommand("openInPopup", { noteIdOrPath: slide.noteId });
    }
}

/**
 * The menu rows of the kinds of note a new slide can be, each adding a slide of its kind, with the
 * slides edited in place first.
 */
export function NewSlideTypeItems({ onNewSlide }: { onNewSlide(type: NewSlideTypeOption): void }) {
    const renderOption = (option: NewSlideTypeOption) => (option.languages
        ? (
            <FormDropdownSubmenu key={option.type} icon={option.icon} title={option.title}>
                {option.languages.map(renderOption)}
                <FormDropdownDivider />
                <FormListItem
                    icon="bx bx-cog"
                    onClick={() => void appContext.triggerCommand("showOptions", { section: "_optionsCodeNotes" })}
                >
                    {t("basic_properties.configure_code_notes")}
                </FormListItem>
            </FormDropdownSubmenu>
        )
        : (
            <FormListItem key={option.mime ?? option.type} icon={option.icon} onClick={() => onNewSlide(option)}>
                {option.title}
            </FormListItem>
        ));
    return getNewSlideTypes().map((group, index) => [
        index > 0 && <FormDropdownDivider key={`divider-${index}`} />,
        ...group.map(renderOption)
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
        <OverlayControlDropdown
            title={t("presentation_view.slide-background")}
            icon="bx-palette"
            panel
            disabled={!note}
        >
            {note && <SlideBackgroundPicker note={note} />}
        </OverlayControlDropdown>
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

function useIsOverviewActive(api: RevealApi | undefined) {
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
    return isOverviewActive;
}

/**
 * Whether the pointer has rested over `element` for {@link IDLE_DELAY}. A move over it resets the
 * wait; a `null` element is never idle.
 */
export function useIsPointerIdle(element: HTMLElement | null) {
    const [ isIdle, setIsIdle ] = useState(false);
    useEffect(() => {
        setIsIdle(false);
        if (!element) return;
        let timeout = setTimeout(() => setIsIdle(true), IDLE_DELAY);
        const onPointerMove = () => {
            setIsIdle(false);
            clearTimeout(timeout);
            timeout = setTimeout(() => setIsIdle(true), IDLE_DELAY);
        };
        element.addEventListener("pointermove", onPointerMove);
        return () => {
            clearTimeout(timeout);
            element.removeEventListener("pointermove", onPointerMove);
        };
    }, [ element ]);
    return isIdle;
}
