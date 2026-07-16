/**
 * Public re-export of the generic FullCalendar-based calendar wrapper as a shared Preact widget.
 *
 * The implementation lives at `../collections/calendar/calendar` for historical reasons; this module
 * exposes it from the reusable `widgets/react/` component folder so features outside the note
 * collection view can consume it without reaching into `collections/calendar`. It is decoupled from
 * Trilium's note model — it deals purely in FullCalendar options and a `calendarRef`.
 */
export { default, type CalendarProps } from "../collections/calendar/calendar";
