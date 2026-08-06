import "./EventPopover.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, MaximizeToQuickEditAction, NoteColorAction, OpenNoteActions, useEmbeddedNoteContext, useFollowLinksWithin } from "../../EmbeddedNotePane";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useLegacyComponentElement, useNote } from "../../react/hooks";
import Modal from "../../react/Modal";
import Popover from "../../react/Popover";
import { removeFromCalendar } from "./api";
import EventDatesEditor from "./EventDatesEditor";
import { EventFieldList } from "./EventField";
import { useEventLabelOmissions } from "./hooks";
import RecurrenceEditor from "./RecurrenceEditor";
import { AnchorPoint } from "./selection";

/**
 * The whole of an event: the note's title, its own fields — when it happens, how it repeats — its
 * promoted attributes and its content, each edited exactly as it is anywhere else (the
 * embedded-note arrangement the geo map's pane makes; see EmbeddedNotePane).
 *
 * Where that stands depends on the screen it stands on. A desktop gets a popover beside the chip
 * that was clicked, so the grid never reflows and the event is read where it was found; a phone
 * gets the sheet the app raises every dialog as, a card anchored beside a chip being wider than the
 * screen it would be anchored on. The same contents either way, and the same note context behind
 * them — only the shell differs, as the icon picker's does (see IconPickerButton).
 *
 * One surface for the selection rather than one per event: clicking another chip is a note switch
 * within a standing surface — the editors hear it and save.
 */
export default function EventPopover({ noteId, anchor, container, parentNote, isEditable, onClose, onFollowLink }: {
    noteId: string;
    /** Where the chip was clicked — which of the event's segments to stand by, and the anchor of
     *  last resort where none can be found on the grid. Of no interest to the sheet, which is
     *  anchored to nothing. */
    anchor: AnchorPoint | null;
    /** The calendar the chips are read out of (see {@link eventAnchorRect}). */
    container: HTMLElement | null;
    /** The calendar's own note, which is how the tree is told what the calendar holds a note by. */
    parentNote: FNote;
    /** The calendar may not be edited, which leaves the surface the ways of opening a note and no
     *  more — a calendar root's day notes are not events to be recoloured or taken off it. */
    isEditable: boolean;
    onClose(): void;
    /** Offered a link's note; answers whether the calendar took the navigation over (see
     *  {@link useFollowLinksWithin} and followLink in index.tsx). */
    onFollowLink(noteId: string): boolean;
}) {
    const note = useNote(noteId);
    const { noteContext, component } = useEmbeddedNoteContext(note ?? undefined, POPOVER_NTX_ID);

    /**
     * Lets the surface go, having given whatever is being edited in it the chance to save — the
     * geo pane's bargain (see its closePane): announced first, while the editors are still
     * mounted, and not waited on. Every way out leads through here.
     */
    const close = useCallback(() => {
        void announceEmbeddedNoteClosing(component, POPOVER_NTX_ID);
        onClose();
    }, [ component, onClose ]);

    if (!note) {
        return null;
    }

    // The scope stands outside the shell rather than within it, so that a sheet's title — which is
    // the note's own title row, handed to the dialog rather than drawn inside its body — reads the
    // note out of the context like everything else does.
    return (
        <EmbeddedNoteScope component={component} noteContext={noteContext}>
            {isMobile() ? (
                <EventSheet note={note} parentNote={parentNote} isEditable={isEditable} onClose={close} onFollowLink={onFollowLink} />
            ) : (
                <EventPopoverShell
                    note={note}
                    anchorRect={() => eventAnchorRect(container, noteId, anchor)}
                    updateKey={noteId}
                    parentNote={parentNote}
                    isEditable={isEditable}
                    onClose={close}
                    onFollowLink={onFollowLink}
                />
            )}
        </EmbeddedNoteScope>
    );
}

/** The event beside its chip, as a desktop shows it. */
function EventPopoverShell({ note, anchorRect, updateKey, parentNote, isEditable, onClose, onFollowLink }: {
    note: FNote;
    anchorRect(): DOMRect;
    updateKey: string;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
    onFollowLink(noteId: string): boolean;
}) {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ onClose ]);

    return (
        <Popover
            className="calendar-event-popover"
            placement={glob.isRtl ? "left-start" : "right-start"}
            getAnchorRect={anchorRect}
            updateKey={updateKey}
            // A press on another chip is not a dismissal but a switch: the click behind it re-points
            // this popover at that event (see onEventClick), which would otherwise have to tear the
            // popover down on the press and build it again on the click.
            keepOpenSelector=".fc-event"
            onDismiss={onClose}
        >
            <EventDetails note={note} parentNote={parentNote} isEditable={isEditable} onClose={onClose} onFollowLink={onFollowLink} />
        </Popover>
    );
}

/**
 * The event as a phone shows it: the sheet the app raises its dialogs as, rising from the foot of
 * the screen (see `body.mobile .modal-dialog` in style.css).
 *
 * Dressed as the quick editor is, that being the app's own way of showing a whole note over
 * whatever raised it — the note's title row heading the dialog rather than standing inside it, at
 * the height it stands there (see the shared rules in PopupEditor.css). It rises to what a dialog
 * may take rather than to the whole page, as the quick editor does: a page-high sheet squares off
 * the corners the app rounds every dialog by, and gains nothing for it.
 *
 * Escape and the backdrop are the dialog's own to answer.
 */
function EventSheet({ note, parentNote, isEditable, onClose, onFollowLink }: {
    note: FNote;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
    onFollowLink(noteId: string): boolean;
}) {
    // Marked on the dialog itself rather than on its body, so that what heads it is inside the
    // marked element too (see {@link useLegacyComponentElement}).
    const modalRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(modalRef);

    // A link to another event switches the sheet, the calendar behind it turning to the event's
    // date for when the sheet comes down (see the shared hook).
    useFollowLinksWithin(modalRef, onFollowLink);

    /*
     * Closing is asked of the dialog rather than done to it: what is inside says it is finished —
     * the event taken off the calendar, above all — and the dialog puts itself away, telling the
     * host once it is down. Ceasing to draw a dialog that is still up leaves Bootstrap's backdrop
     * behind, that being laid over the body rather than within the dialog, and a phone left with a
     * page it cannot press is the worst of the ways this could go wrong.
     */
    const [ shown, setShown ] = useState(true);

    return (
        <Modal
            className="calendar-event-sheet"
            size="lg"
            title={<TitleRow />}
            modalRef={modalRef}
            show={shown}
            onHidden={onClose}
        >
            <EventDetailsBody
                note={note}
                parentNote={parentNote}
                isEditable={isEditable}
                onClose={() => setShown(false)}
            />
        </Modal>
    );
}

/** The popover's own ntxId, as the geo pane and the quick editor have one of their own. */
const POPOVER_NTX_ID = "_calendar-event-popover";

/** The popover's contents: what heads it, and the event under that. */
function EventDetails({ note, parentNote, isEditable, onClose, onFollowLink }: {
    note: FNote;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
    onFollowLink(noteId: string): boolean;
}) {
    // The popover stands for its component in the DOM, which is how the text editor finds its
    // host — without this it resolves the widget enclosing the calendar instead (see the geo pane).
    // A sheet marks its dialog instead, what heads it being the dialog's own.
    const innerRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(innerRef);

    // A link to another event switches this popover, the calendar turning to the event's date and
    // the popover re-anchoring to its chip (see the shared hook and followLink in index.tsx).
    useFollowLinksWithin(innerRef, onFollowLink);

    return (
        <div className="calendar-event-popover-inner" ref={innerRef}>
            <div className="calendar-event-popover-header">
                <TitleRow compact />
                {/* A sheet is offered no maximize: it already has the whole screen to grow into. */}
                <MaximizeToQuickEditAction note={note} onClose={onClose} />
                <ActionButton
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onClose}
                />
            </div>

            <EventDetailsBody note={note} parentNote={parentNote} isEditable={isEditable} onClose={onClose} />
        </div>
    );
}

/**
 * The event itself, under whatever heads it: what can be done with it, its own fields, the note's
 * promoted attributes and the note. Shared by the two shells, which differ only in what they put
 * around this and how they are dismissed.
 */
function EventDetailsBody({ note, parentNote, isEditable, onClose }: {
    note: FNote;
    parentNote: FNote;
    isEditable: boolean;
    onClose(): void;
}) {
    // The labels the body's own fields already speak for, so the promoted grid does not repeat
    // them: the dates the calendar draws the event by and the recurrence — under the stock names
    // and whatever names the note draws them by instead (see useEventLabelOmissions).
    const eventLabels = useEventLabelOmissions(note);

    return (
        <div className="calendar-event-popover-body tn-embedded-note-pane">
                {/* What can be done with the event: the ways of opening its note (see
                    OpenNoteActions), then the ways of changing it — left out rather than disabled
                    where the calendar may not be edited, as the geo pane leaves them out. */}
                <EmbeddedNoteActions>
                    <OpenNoteActions note={note} />

                    {isEditable && <>
                        {/* Named for the chip it dresses, the colour it sets being worn everywhere
                            the note shows (see NoteColorPicker). */}
                        <NoteColorAction note={note} title={t("calendar_view.event_color")} />

                        <ActionButton
                            className="tn-embedded-note-remove"
                            icon="bx bx-trash"
                            text={t("calendar_view.remove_from_calendar")}
                            // Whether the note goes with its event is asked before anything
                            // happens, the two being different wishes. Closed by hand where
                            // something was done: a removed event is still a note of the
                            // collection, so no watcher stands the popover down.
                            onClick={() => void removeFromCalendar(note, parentNote)
                                .then((removed) => removed && onClose())}
                        />
                    </>}
                </EmbeddedNoteActions>

                {/* The event's own fields — when it happens, how it repeats — which are ways of
                    changing it, so they go where the calendar may be edited: a calendar root's day
                    notes are days, and a day neither moves nor recurs. */}
                {isEditable && (
                    <EventFieldList>
                        {/* The repeats field is handed to the dates editor to stand beside its
                            all-day switch, the two being the one line of shape-of-the-event
                            switches (see EventDatesEditor). */}
                        <EventDatesEditor note={note} repeats={<RecurrenceEditor note={note} />} />
                    </EventFieldList>
                )}

                <PromotedAttributes omit={eventLabels} />
                <NoteDetail />
        </div>
    );
}

/**
 * Where the popover stands: beside the event's own chip, read back off the grid by the note id the
 * chips are tagged with (see eventDidMount in index.tsx). An event crossing rows draws a chip per
 * row, so the one under the click is the one pointed at, falling back to the first drawn, and to
 * the bare click point where no chip is on the grid at all. Read afresh on every reposition (see
 * Popover), so the popover follows the chip through scrolls and redraws.
 */
function eventAnchorRect(container: HTMLElement | null, noteId: string, point: AnchorPoint | null): DOMRect {
    const chips = container?.querySelectorAll<HTMLElement>(`.fc-event[data-event-note-id="${CSS.escape(noteId)}"]`);

    if (chips?.length) {
        let pick: HTMLElement | undefined;
        if (point) {
            for (const el of chips) {
                const r = el.getBoundingClientRect();
                if (r.left <= point.x && point.x <= r.right && r.top <= point.y && point.y <= r.bottom) {
                    pick = el;
                    break;
                }
            }
        }
        return (pick ?? chips[0]).getBoundingClientRect();
    }

    return new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0);
}
