import "./GhostPopover.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { type NoteTypeOption } from "../../../services/note_types";
import { isMobile } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { isWithinFloatingLayer } from "../../react/floating_layers";
import FormTextBox from "../../react/FormTextBox";
import Modal from "../../react/Modal";
import Popover from "../../react/Popover";
import TemplateDropdown, { type TemplateChoice } from "../../react/TemplateDropdown";
import { EventDatesFields } from "./EventDatesEditor";
import { EventRow } from "./EventField";
import { AnchorPoint, EventDraft, narrowAnchorRect, normalizeEventDates } from "./selection";

/**
 * The form for a new event before its note exists: a title field and the date and time fields
 * (`EventDatesFields`). Dismissing it (Escape, the close button, a click outside) creates nothing.
 *
 * A desktop stands it beside the range that called for it, a draft being born of a place: the form
 * appears where the eye already is, and the grid does not reflow under the very range just dragged.
 * A phone gets the sheet the app raises its dialogs as, there being no room beside anything (see
 * EventPopover, which divides itself the same way). Committed, it simply goes: the calendar is left
 * as it was found, with the new chip on it (see commitDraft in index.tsx).
 *
 * Committing with the title blank is allowed and meaningful: the note is then named by the
 * calendar's own `#titleTemplate` where one is set (see getNewNoteTitle in trilium-core), which
 * the old title prompt used to override with whatever stood in its box.
 */
export default function GhostPopover({
    draft: initialDraft, anchor, container, templates, onCommit, onCancel, onDismiss
}: {
    draft: EventDraft;
    /** Where the drag ended, in viewport coordinates — which of the shading's pieces to stand by,
     *  and the anchor of last resort when the shading cannot be found at all. */
    anchor: AnchorPoint | null;
    /** The calendar the range's shading is read out of (see {@link ghostAnchorRect}). */
    container: HTMLElement | null;
    /** What the event is made from, picked in the row below the dates. */
    templates: TemplateChoice;
    /** Answers when the note has been made, or rejects having failed to make one — the ghost stays
     *  up for a second try either way it is told (see {@link commit}). */
    onCommit(title: string, draft: EventDraft, template: NoteTypeOption | undefined): Promise<void> | void;
    /** The draft given up on: Escape, or the close button. */
    onCancel(): void;
    /**
     * The draft pressed away from, which the host answers differently — the press itself decides
     * what becomes of the range's shading, and the ghost is in no position to say (see
     * dismissDraft in index.tsx).
     */
    onDismiss(): void;
}) {
    const [ title, setTitle ] = useState("");
    // The range as dragged, until the user changes whether it is all-day or edits its hours.
    const [ draft, setDraft ] = useState(() => normalizeEventDates(initialDraft));
    useEffect(() => setDraft(normalizeEventDates(initialDraft)), [ initialDraft ]);
    // Committing is asked for once, however many times Enter falls before the note arrives and
    // the form goes: each ask would make its own note.
    const [ committing, setCommitting ] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);

    /**
     * Focuses the field once its container shows: `Popover` keeps the card hidden until it is
     * placed, and Bootstrap's focus trap takes the focus back while the `Modal` opens.
     *
     * Stable across renders, so `Modal` does not rebind its listeners on every keystroke.
     */
    const focusTitle = useCallback(() => titleRef.current?.focus(), []);

    /**
     * Asks for the note, once: the form is held shut while the request is out, or each Enter falling
     * before the note arrives would make one of its own.
     *
     * Held shut only for as long as the asking lasts. A request that fails leaves the draft exactly
     * as it stood — nothing was created, and the calendar keeps the ghost up — so the form is opened
     * again for a second try rather than stranding the title just typed behind a button that can no
     * longer be pressed. What went wrong is already said by the request itself (see server.ts, which
     * shows the error before it throws). Succeeded, there is nothing to reopen: the draft resolves
     * and the ghost goes with it (see commitDraft in index.tsx).
     */
    const commit = async () => {
        if (committing) return;
        setCommitting(true);
        try {
            await onCommit(title, draft, templates.current);
        } catch {
            setCommitting(false);
        }
    };

    // The sheet answers Escape itself, being a dialog; the popover is not, so it listens.
    useEffect(() => {
        if (isMobile()) return;

        const onKeyDown = (e: KeyboardEvent) => {
            // An Escape in a dialog or menu opened over the popover closes only that.
            if (e.key === "Escape" && !isWithinFloatingLayer(e.target)) onCancel();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ onCancel ]);

    const form = (
        <div className="calendar-ghost-body">
            <FormTextBox
                inputRef={titleRef}
                currentValue={title}
                placeholder={t("calendar_view.draft_title_placeholder")}
                onChange={setTitle}
                onKeyDown={(e) => {
                    if (e.key === "Enter") void commit();
                }}
            />

            <div className="calendar-ghost-when">
                <EventDatesFields value={draft} onChange={setDraft} />
                <EventRow icon="bx-detail" title={t("calendar_view.template")}>
                    <TemplateDropdown
                        {...templates}
                        title={t("calendar_view.event_template")}
                        moreText={t("calendar_view.more_templates")}
                    />
                </EventRow>
            </div>

            <div className="calendar-ghost-actions">
                <Button
                    kind="primary"
                    text={t("calendar_view.create_event")}
                    disabled={committing}
                    onClick={() => void commit()}
                />
            </div>
        </div>
    );

    // A sheet rather than a card beside the range: a phone has no beside. Left at the height a
    // dialog rises to rather than given the whole page — the form is three lines, and a page of it
    // would hide the calendar for no gain. Backdrop and Escape are the dialog's own way out, which
    // is a giving-up rather than a pressing-away: there is no grid under a backdrop to press on.
    if (isMobile()) {
        return (
            <Modal
                className="calendar-ghost-sheet"
                size="md"
                title={t("calendar_view.new_event")}
                show
                onShown={focusTitle}
                onHidden={onCancel}
            >
                {form}
            </Modal>
        );
    }

    return (
        <Popover
            className="calendar-ghost-popover"
            placement={glob.isRtl ? "left-start" : "right-start"}
            getAnchorRect={() => ghostAnchorRect(container, anchor)}
            onDismiss={onDismiss}
            onPlaced={focusTitle}
        >
            <div className="calendar-ghost-header">
                <span className="calendar-ghost-heading">{t("calendar_view.new_event")}</span>
                <ActionButton
                    icon="bx bx-x"
                    text={t("calendar.close_details")}
                    onClick={onCancel}
                />
            </div>

            {form}
        </Popover>
    );
}

/**
 * Where the ghost stands: beside the range's own shading, read back off the grid. FullCalendar
 * draws the selection as one piece per row it crosses, so the piece under the mouseup is the one
 * pointed at — where the drag ended is where the eye is — falling back to the last piece drawn, and
 * to the bare point where no shading is on the grid at all. Read afresh on every reposition (see
 * Popover), so the ghost follows the shading through scrolls and redraws.
 *
 * A piece too wide to be stood beside — a range dragged across a whole week — is narrowed to the
 * end of the drag within it (see {@link narrowAnchorRect}).
 *
 * The pieces answer to the name the calendar gives them through `highlightClass`, FullCalendar
 * having no class of its own left to go by (see the calendar view).
 */
function ghostAnchorRect(container: HTMLElement | null, point: AnchorPoint | null): DOMRect {
    const highlights = container?.querySelectorAll<HTMLElement>(".calendar-highlight");

    if (highlights?.length) {
        let pick: HTMLElement | undefined;
        if (point) {
            for (const el of highlights) {
                const r = el.getBoundingClientRect();
                if (r.left <= point.x && point.x <= r.right && r.top <= point.y && point.y <= r.bottom) {
                    pick = el;
                    break;
                }
            }
        }
        return narrowAnchorRect((pick ?? highlights[highlights.length - 1]).getBoundingClientRect(), point);
    }

    return new DOMRect(point?.x ?? 0, point?.y ?? 0, 0, 0);
}
