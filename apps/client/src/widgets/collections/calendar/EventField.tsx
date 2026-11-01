import "./EventField.css";

import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { getTimedDurationMinutes } from "./utils";

/**
 * The column of an event's own fields — how the event popover says what the calendar draws the
 * event by (its recurrence, and in time its start and end dates), those being kept out of the
 * promoted grid (see EVENT_LABELS in EventPopover.tsx). One shared shape so every field of the
 * event reads as a row of the same form.
 */
export function EventFieldList({ children }: { children: ComponentChildren }) {
    return <div className="calendar-event-fields">{children}</div>;
}

/**
 * One field of the event: its name over whatever edits it. The name is a `<label>` where there is
 * one input to speak for ({@link htmlFor}), and reads as a heading where the field is a group —
 * a row of weekday toggles has no single input to point at.
 */
export function EventField({ name, htmlFor, children }: {
    name: string;
    /** The id of the field's input, for a field that has exactly one. */
    htmlFor?: string;
    children: ComponentChildren;
}) {
    return (
        <div className="calendar-event-field">
            <label className="calendar-event-field-name" for={htmlFor}>{name}</label>
            {children}
        </div>
    );
}

/**
 * A row of event controls led by an icon, with `title` as the icon's tooltip. Without `icon`, the
 * icon column stays empty so the controls align with the rows above.
 */
export function EventRow({ icon, title, rowRef, children }: {
    /** A boxicons class such as `bx-calendar`. */
    icon?: string;
    title?: string;
    rowRef?: RefObject<HTMLDivElement | null>;
    children: ComponentChildren;
}) {
    return (
        <div ref={rowRef} className="calendar-event-row">
            <span className={clsx("calendar-event-row-icon", icon && `bx ${icon}`)} title={title} aria-hidden="true" />
            {children}
        </div>
    );
}

/**
 * Controls standing in one line, for a field said as a sentence — "every [2] weeks", "after [10]
 * times" — rather than as a single box.
 */
export function EventFieldControls({ className, children }: {
    className?: string;
    children: ComponentChildren;
}) {
    return <div className={clsx("calendar-event-field-controls", className)}>{children}</div>;
}

/**
 * The time row: an "Add time" button when `hasTime` is false, otherwise `children` and a remove
 * button. After either button is pressed, the focus moves to the control that replaces it.
 */
export function EventTimeRow({ hasTime, onAdd, onRemove, children }: {
    hasTime: boolean;
    onAdd(): void;
    onRemove(): void;
    children: ComponentChildren;
}) {
    const rowRef = useRef<HTMLDivElement>(null);
    const moveFocus = useRef(false);

    useLayoutEffect(() => {
        if (!moveFocus.current) return;
        moveFocus.current = false;
        const target = hasTime ? "input" : ".calendar-event-add-time";
        rowRef.current?.querySelector<HTMLElement>(target)?.focus();
    }, [ hasTime ]);

    return (
        <EventRow icon="bx-time-five" title={t("calendar.dates.time")} rowRef={rowRef}>
            {hasTime ? <>
                {children}
                <ActionButton
                    className="calendar-event-remove-time"
                    icon="bx bx-x"
                    text={t("calendar.dates.remove_time")}
                    onClick={() => {
                        moveFocus.current = true;
                        onRemove();
                    }}
                />
            </> : (
                <Button
                    className="calendar-event-add-time"
                    kind="lowProfile"
                    icon="bx-plus"
                    text={t("calendar.dates.add_time")}
                    onClick={() => {
                        moveFocus.current = true;
                        onAdd();
                    }}
                />
            )}
        </EventRow>
    );
}

/** The duration of a timed event (see `getTimedDurationMinutes()`); nothing for an all-day event. */
export function EventDuration({ event }: { event: Parameters<typeof getTimedDurationMinutes>[0] }) {
    const total = getTimedDurationMinutes(event);
    if (total === null) return null;

    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    const text = !hours
        ? t("calendar_view.duration_minutes", { minutes })
        : !minutes
            ? t("calendar_view.duration_hours", { hours })
            : t("calendar_view.duration_hours_minutes", { hours, minutes });
    return <span className="calendar-event-duration">{text}</span>;
}
