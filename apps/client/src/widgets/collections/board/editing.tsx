import clsx from "clsx";
import {
    ComponentChildren, RefObject, TargetedFocusEvent, TargetedKeyboardEvent, TargetedMouseEvent,
    TargetedPointerEvent
} from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isIMEComposing } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import { escapeHtml } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import FormTextArea from "../../react/FormTextArea";
import FormTextBox from "../../react/FormTextBox";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import NoteAutocomplete from "../../react/NoteAutocomplete";
import type { HoldOpen } from ".";
import BoardApi from "./api";
import { type BoardDragCallbacks, useBoardDrag } from "./board_drag";
import { DEFAULT_COLUMN_ICON } from "./columns";
import { openCreateColumnMenu } from "./context_menu";

export { default as ColumnLimitDialog } from "./column_limit";
export { default as BoardProperties } from "./properties";

/**
 * Drives the drag of cards and columns over the board's container, and measures the board again
 * while a card is carried, since a column opened to take it moves every column after it.
 *
 * Only a column carried is measured among the columns as they stood when it was picked up, which
 * is the list the place it would take is counted against.
 */
export function BoardDrag({
    containerRef, callbacks, isCarryingColumn, activeColumn, shownColumns, onDraggingChange
}: {
    containerRef: RefObject<HTMLElement | null>;
    callbacks: BoardDragCallbacks;
    isCarryingColumn: boolean;
    /** The column drawn open, which changes the board's measurements as it opens. */
    activeColumn: string | undefined;
    shownColumns: string[];
    onDraggingChange: (isDragging: boolean) => void;
}) {
    const { isDragging, remeasure } = useBoardDrag(containerRef, callbacks);

    useLayoutEffect(() => {
        onDraggingChange(isDragging);
    }, [ isDragging, onDraggingChange ]);

    useLayoutEffect(() => {
        if (isDragging && !isCarryingColumn) {
            remeasure();
        }
    }, [ isDragging, isCarryingColumn, remeasure, activeColumn, shownColumns ]);

    return null;
}

export function AddNewColumn({
    api, isInRelationMode, columnCount, onCreated, isCreating, setIsCreating
}: {
    api: BoardApi,
    isInRelationMode: boolean,
    /** How many columns stand before this, which is what carries it past the board's edge. */
    columnCount: number,
    /** Names the column just made, which the board reveals as it draws it. */
    onCreated: (column: string) => void,
    /** Whether the editor is open. The board's own menu opens the same one this slot opens. */
    isCreating: boolean,
    setIsCreating: (isCreating: boolean) => void
}) {
    const isCreatingNewColumn = isCreating;
    const setIsCreatingNewColumn = setIsCreating;
    // Kept between columns, as the card editor keeps its own: a run of columns is often a run of
    // the same kind of column.
    const [ icon, setIcon ] = useState(DEFAULT_COLUMN_ICON);
    const slotRef = useRef<HTMLDivElement>(null);

    // Keyed on the count rather than done when the write returns: the column it makes room for is
    // drawn by a refresh that has yet to run at that point, so the board is not yet as wide as it
    // is about to be.
    useLayoutEffect(() => {
        if (!isCreatingNewColumn) {
            return;
        }

        const board = slotRef.current?.closest<HTMLElement>(".board-view-container");
        if (!board) {
            return;
        }

        board.scrollLeft = board.scrollWidth;
    }, [ columnCount, isCreatingNewColumn ]);

    const addColumnCallback = useCallback(() => {
        setIsCreatingNewColumn(true);
    }, []);

    const keydownCallback = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter") {
            setIsCreatingNewColumn(true);
        }
    }, []);

    return (
        <div
            ref={slotRef}
            className={`board-add-column ${isCreatingNewColumn ? "editing" : ""}`}
            onClick={addColumnCallback}
            onKeyDown={keydownCallback}
            tabIndex={300}
        >
            {!isCreatingNewColumn
                ? <>
                    <Icon icon="bx bx-plus" />{" "}
                    {t("board_view.add-column")}
                </>
                : (
                    <TitleEditor
                        placeholder={t("board_view.add-column-placeholder")}
                        save={async (columnName, atStart) => {
                            const created = await api.addNewColumn(columnName, atStart,
                                icon !== DEFAULT_COLUMN_ICON ? icon : undefined);
                            if (created) {
                                onCreated(columnName);
                            } else {
                                toast.showMessage(t("board_view.column-already-exists"), undefined, "bx bx-duplicate");
                            }
                        }}
                        dismiss={() => setIsCreatingNewColumn(false)}
                        isNewItem
                        // Columns are added in runs as a board is set up, so the editor is left
                        // standing with an empty field. A column named by a note answers for
                        // itself, since picking one is what closes that editor.
                        saveAndContinue={!isInRelationMode}
                        submitTitle={t("board_view.create-new-column")}
                        openPlacements={openCreateColumnMenu}
                        // The same picker the column's own heading carries, so a column is given
                        // its icon as it is named rather than after it stands there.
                        icon={{
                            current: icon,
                            onSelect: setIcon,
                            onReset: icon !== DEFAULT_COLUMN_ICON
                                ? () => setIcon(DEFAULT_COLUMN_ICON)
                                : undefined
                        }}
                        mode={isInRelationMode ? "relation" : "normal"}
                    />
                )}
        </div>
    );
}

export function TitleEditor({
    currentValue, placeholder, save, dismiss, mode, isNewItem, selectOnFocus = true,
    saveAndContinue = false, handsOver = false, returnFocusTo, abandon, whenEmpty, submitTitle,
    openPlacements, icon, footer
}: {
    currentValue?: string;
    placeholder?: string;
    /**
     * Writes what was typed. Returns `false` to refuse it, which keeps the editor open on what it
     * holds so the reader can correct it.
     */
    save: (newValue: string, atStart?: boolean) => false | void | Promise<void>;
    dismiss: () => void;
    isNewItem?: boolean;
    mode?: "normal" | "multiline" | "relation";
    /**
     * Whether Enter saves and clears the editor rather than closing it, so a run of cards can be
     * typed one after another. Enter is then the only thing that saves: Escape and losing focus
     * discard what was typed and close the editor. An editor left standing between cards is walked
     * away from often enough that saving on the way out would create cards nobody asked for.
     */
    saveAndContinue?: boolean;
    /**
     * Whether the field keeps what was typed once it has saved, and saves only once.
     *
     * For an editor the caller takes down as what it made takes its place: emptied instead, the
     * field would stand where the new thing is about to be drawn without holding what it says.
     */
    handsOver?: boolean;
    /** Reports what was typed and not saved, so reopening the editor can restore it. */
    abandon?: (typed: string) => void;
    /**
     * What the button does while the field is empty, drawn as `bx bx-folder-open`. Without it no
     * button is drawn at all until something is typed.
     */
    whenEmpty?: { title: string, onClick?: () => void };
    /** Names what the button creates, shown in its tooltip. */
    submitTitle?: string;
    /**
     * What stands at the foot of the field, inside its own box: the pill naming what a new card
     * will be made from. The field is given room for it.
     */
    footer?: (hold: HoldOpen) => ComponentChildren;
    /**
     * The icon shown inside the field, at the leading edge, which opens the picker when pressed.
     * The caller answers for what a pick does: a card carries it as `iconClass`, and the editor a
     * card is made in keeps it for the next card.
     */
    icon?: { current: string, onSelect: (icon: string) => void, onReset?: () => void };
    /**
     * Opens the menu naming which end to create at, for a `save` that reads `atStart`. Passing it
     * is what gives the button both ends: a right click or a hold opens the menu, Shift+Enter
     * saves at the start.
     */
    openPlacements?: (x: number, y: number, place: (atStart: boolean) => void) => void;
    /**
     * Where focus goes when the editor closes, instead of back to whatever held it before. A card
     * whose editor was opened by an insert passes its own element, so closing does not focus the
     * card the insert was made from.
     */
    returnFocusTo?: RefObject<HTMLElement | null>;
    /**
     * Whether opening the editor selects the text already in it, which is what a rename wants. An
     * editor opened part-typed puts the caret after the text instead, so the next key continues it.
     */
    selectOnFocus?: boolean;
}) {
    const inputRef = useRef<any>(null);
    /**
     * What the field holds. Kept in state because `FormTextBox` takes its value as a prop: any
     * other render, the button changing icon included, would write a stale prop back over it.
     */
    const [ typed, setTyped ] = useState(currentValue ?? "");
    const isEmpty = !typed.trim();
    const focusElRef = useRef<Element>(null);
    const dismissOnNextRefreshRef = useRef(false);
    const shouldDismiss = useRef(false);
    /**
     * Whether something the field carries is open, during which the editor stays where it is.
     *
     * A menu takes focus with it, and losing focus is what closes this editor: it would take the
     * menu down with itself, which is what the icon picker and the pill naming what a card is made
     * from both do. Held in a ref rather than in state because the blur arrives before the render
     * a state change would schedule; focus goes back to the field as the menu closes, the blur
     * that would have ended the edit being spent.
     */
    const isHoldingOpen = useRef(false);
    /** The box holding the field and the picker. `iconFocusOut` tests `relatedTarget` against it. */
    const fieldRef = useRef<HTMLDivElement>(null);
    const iconRef = useRef<HTMLSpanElement>(null);
    /**
     * Whether the icon picker holds focus, which Shift+Tab hands to it.
     *
     * Set before focus moves rather than when the picker receives it: the field blurs first, and
     * that blur is what would close the editor.
     */
    const isIconFocused = useRef(false);
    const holdOpen = useMemo<HoldOpen>(() => ({
        onOpened: () => { isHoldingOpen.current = true; },
        onClosed: () => {
            isHoldingOpen.current = false;
            inputRef.current?.focus();
        }
    }), []);
    /** Whether the field has already saved, for one that keeps what it saved standing. */
    const hasHandedOver = useRef(false);
    const held = useRef<number | undefined>(undefined);
    /** Where on the screen the finger went down, against which a scroll is told from a hold. */
    const heldFrom = useRef<{ x: number, y: number } | undefined>(undefined);
    /** Whether the menu was opened by a hold, whose press ends in a click the menu must survive. */
    const openedByHold = useRef(false);

    useEffect(() => () => window.clearTimeout(held.current), []);

    // Laid out rather than deferred: with the open drawn synchronously, this puts focus on the
    // editor inside the press that asked for it, which is what opens a phone's keyboard.
    useLayoutEffect(() => {
        focusElRef.current = document.activeElement !== document.body ? document.activeElement : null;
        inputRef.current?.focus();

        if (selectOnFocus) {
            inputRef.current?.select();
        } else {
            const end = inputRef.current?.value.length ?? 0;
            inputRef.current?.setSelectionRange(end, end);
        }
    }, [ inputRef ]);

    useEffect(() => {
        if (dismissOnNextRefreshRef.current) {
            dismiss();
            dismissOnNextRefreshRef.current = false;
        }
    });

    const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement> | KeyboardEvent) => {
        // Skip processing during IME composition so the Enter that commits a
        // CJK conversion does not also save the title with unconfirmed text.
        if (isIMEComposing(e)) {
            return;
        }

        if (e.key === "Tab" && e.shiftKey && icon) {
            const button = iconRef.current?.querySelector("button");
            if (button) {
                e.preventDefault();
                e.stopPropagation();
                isIconFocused.current = true;
                button.focus();
                return;
            }
        }

        if (e.key === "Enter" && saveAndContinue) {
            e.preventDefault();
            e.stopPropagation();
            submit(!!openPlacements && e.shiftKey);
            return;
        }

        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            const target = returnFocusTo?.current ?? focusElRef.current;
            if (target instanceof HTMLElement) {
                shouldDismiss.current = (e.key === "Escape");
                target.focus();
                return;
            }

            // Nothing to hand focus back to, and it is the blur of handing it back that saves. An
            // editor opened by a press on the thing it edits, rather than from something focused,
            // has nowhere to send it, so Enter says here what that blur would have said.
            const typed = inputRef.current?.value ?? "";
            if (e.key === "Enter" && typed.trim() && (typed !== currentValue || isNewItem)
                    && !commit(typed)) {
                return;
            }

            dismiss();
        }
    };

    /**
     * Saves what is in the editor and empties it, leaving it open for whatever comes next.
     *
     * @param atStart whether to save at the near end, for an editor that offers both.
     * @param typed what to save, for a menu that read the field when it opened rather than now.
     */
    function submit(atStart?: boolean, typed?: string) {
        const input = inputRef.current;
        const value = typed ?? input?.value ?? "";

        if (value.trim()) {
            if (hasHandedOver.current) {
                return;
            }

            if (!commit(value, atStart)) {
                input?.focus();
                return;
            }

            if (handsOver) {
                hasHandedOver.current = true;
                input?.focus();
                return;
            }

            if (input) {
                input.value = "";
            }
        }

        input?.focus();
        setTyped("");
    }

    /** Offers both ends, saving what the field held when the menu was opened. */
    function openPlacementMenu(e: TargetedMouseEvent<HTMLElement>) {
        e.preventDefault();
        e.stopPropagation();
        cancelHold();

        const typed = inputRef.current?.value ?? "";
        openPlacements?.(e.pageX, e.pageY, (atStart) => submit(atStart, typed));
    }

    /** Opens the same menu for a finger, which has no second button to open it with. */
    function holdToPlace(e: TargetedPointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse") {
            return;
        }

        const { pageX, pageY, clientX, clientY } = e;
        cancelHold();
        heldFrom.current = { x: clientX, y: clientY };
        held.current = window.setTimeout(() => {
            openedByHold.current = true;
            const typed = inputRef.current?.value ?? "";
            openPlacements?.(pageX, pageY, (atStart) => submit(atStart, typed));
        }, HOLD_TO_PLACE_MS);
    }

    function cancelHold() {
        window.clearTimeout(held.current);
        heldFrom.current = undefined;
    }

    /** Gives up on a hold the finger has walked away from, which is a scroll and not a press. */
    function holdMoved(e: TargetedPointerEvent<HTMLElement>) {
        const from = heldFrom.current;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > HOLD_SLACK_PX) {
            cancelHold();
        }
    }

    function pressed(e: TargetedMouseEvent<HTMLElement>) {
        cancelHold();

        // A hold ends in a click, which would reach the page and close the menu it just opened.
        if (openedByHold.current) {
            openedByHold.current = false;
            e.stopPropagation();
            return;
        }

        submit(false);
    }

    const onBlur = (newValue: string) => {
        if (isHoldingOpen.current || isIconFocused.current) {
            return;
        }

        if (saveAndContinue) {
            abandon?.(newValue);
            dismiss();
            return;
        }

        if (!shouldDismiss.current && newValue.trim() && (newValue !== currentValue || isNewItem)) {
            if (!commit(newValue)) {
                // The field stays open, so the focus this blur took off it has to come back.
                inputRef.current?.focus();
                return;
            }

            dismissOnNextRefreshRef.current = true;
        } else {
            dismiss();
        }
    };

    /**
     * Ends the edit when focus moves outside `fieldRef`. A `relatedTarget` inside it is the field
     * itself; `isHoldingOpen` covers the picker's menu, which is drawn outside `fieldRef`.
     */
    function iconFocusOut(e: TargetedFocusEvent<HTMLSpanElement>) {
        isIconFocused.current = false;

        const next = e.relatedTarget;
        if (isHoldingOpen.current || (next instanceof Node && fieldRef.current?.contains(next))) {
            return;
        }

        onBlur(inputRef.current?.value ?? "");
    }

    /** Leaves the editor from the picker, which Escape does from the field itself. */
    function iconKeyDown(e: TargetedKeyboardEvent<HTMLSpanElement>) {
        if (e.key !== "Escape" || isHoldingOpen.current) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        shouldDismiss.current = true;

        const target = returnFocusTo?.current ?? focusElRef.current;
        if (target instanceof HTMLElement) {
            target.focus();
            return;
        }

        isIconFocused.current = false;
        dismiss();
    }

    /**
     * Saves what was typed and reports whether `save` accepted it.
     *
     * A refusal is reported by `save` itself, which is what knows why it refused. A save that
     * fails later is reported here instead of rejecting unhandled: the editor has closed by then,
     * and whatever could not be written has already been put back.
     */
    function commit(newValue: string, atStart?: boolean) {
        const outcome = save(newValue, atStart);
        if (outcome === false) {
            return false;
        }

        Promise.resolve(outcome).catch((e) => {
            console.error("Failed to save what the board editor was given:", e);
            toast.showError(t("board_view.save-error"));
        });
        return true;
    }

    if (mode !== "relation") {
        const Element = mode === "multiline" ? FormTextArea : FormTextBox;
        const field = (
            <Element
                inputRef={inputRef}
                currentValue={typed}
                placeholder={placeholder}
                autoComplete="trilium-title-entry" // forces the auto-fill off better than the "off" value.
                rows={mode === "multiline" ? 4 : undefined}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
                onInput={(e) => setTyped(e.currentTarget.value)}
            />
        );

        if (!saveAndContinue && !icon && !footer) {
            return field;
        }

        // A placement applies only to the button that creates. With nothing typed there is nothing
        // to create, so the button stands for whatever the caller offers instead, or for nothing.
        // An editor that saves once, a card being renamed above all, makes nothing and offers none.
        const offersPlacement = !!openPlacements && !isEmpty;
        const madeBy = submitTitle ?? t("board_view.add-new-item");
        const offered = isEmpty
            ? whenEmpty && {
                icon: "bx bx-folder-open", title: whenEmpty.title, onClick: whenEmpty.onClick
            }
            : saveAndContinue && {
                icon: "bx bx-plus-circle",
                title: offersPlacement
                    ? `<span class="action">${escapeHtml(madeBy)}</span>`
                        + `<span class="hint">${escapeHtml(t("board_view.create-hold-hint"))}</span>`
                    : madeBy,
                onClick: pressed
            };

        return (
            <div ref={fieldRef} className={clsx("title-editor-field", {
                "with-submit": saveAndContinue,
                "with-footer": !!footer
            })}>
                {/* The press that opens the picker must not take focus out of the field: the
                    blur arrives before the picker reports itself open, and losing focus is what
                    closes the editor. */}
                {icon && (
                    <span
                        ref={iconRef}
                        onMouseDown={(e) => e.preventDefault()}
                        onFocusOut={iconFocusOut}
                        onKeyDown={iconKeyDown}
                    >
                        <IconPickerButton
                            className="title-editor-icon"
                            icon={icon.current}
                            title={t("board_view.change-note-icon")}
                            onSelect={icon.onSelect}
                            onReset={icon.onReset}
                            // A grid of a thousand icons and a search field is a task of its own,
                            // so the board behind it is dimmed rather than left looking pressable.
                            backdrop
                            {...holdOpen}
                        />
                    </span>
                )}
                {field}
                {/* The press must not take focus out of the field first: losing it is what closes
                    the editor, and it would be gone before the click arrived. */}
                {offered && (
                    <span
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={offersPlacement ? holdToPlace : undefined}
                        onPointerUp={cancelHold}
                        onPointerMove={holdMoved}
                        onPointerCancel={cancelHold}
                        onContextMenu={offersPlacement ? openPlacementMenu : undefined}
                    >
                        <ActionButton
                            className="title-editor-submit"
                            icon={offered.icon}
                            text={offered.title}
                            tooltipHtml={offersPlacement}
                            tooltipClass={
                                offersPlacement ? "title-editor-submit-tooltip" : undefined}
                            onClick={offered.onClick}
                        />
                    </span>
                )}
                {/* Inside the field's own box, in the room made for it below the text. The press
                    must not take focus out of the field, which is what closes the editor. */}
                {footer && (
                    <span
                        className="title-editor-footer"
                        onMouseDown={(e) => e.preventDefault()}
                    >{footer(holdOpen)}</span>
                )}
            </div>
        );
    }
    return (
        <NoteAutocomplete
            inputRef={inputRef}
            noteId={currentValue ?? ""}
            opts={{
                hideAllButtons: true,
                allowCreatingNotes: true
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    dismiss();
                }
            }}
            onBlur={() => dismiss()}
            noteIdChanged={(newValue) => {
                if (newValue && !commit(newValue)) {
                    return;
                }

                dismiss();
            }}
        />
    );

}

/** How long a finger stays on the create button before it offers where to put the card. */
const HOLD_TO_PLACE_MS = 500;

/** How far the pointer can move during that and still count as a hold rather than a scroll. */
const HOLD_SLACK_PX = 10;
