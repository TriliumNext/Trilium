# Timeline
> [!IMPORTANT]
> The Timeline is a beta feature.

The Timeline displays notes as bars on a horizontal time axis. Each note in the collection gets a row of its own, and the rows are nested the same way the notes are nested in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. A note with a start date and optionally an end date is drawn as a bar on its row; a note without dates keeps an empty row.

The Timeline reads the same dates as the <a class="reference-link" href="Calendar.md">Calendar</a>, so a collection can be switched between the two views without changing its notes.

## Creating a timeline

Right click on an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, select _Insert child note_ and look for _Timeline_.

To turn an existing collection into a timeline, change its view type to _Timeline_ in the <a class="reference-link" href="Collection%20Properties.md">Collection Properties</a>.

## Interaction

*   To add a note to the timeline, click the <span class="tn-icon bx bx-plus"></span> button in the header of the left column. To add a child note under a row, hover the row and click its <span class="tn-icon bx bx-plus"></span> button. The new note opens beside the button, where it can be named and dated.
*   To schedule a note, drag across the days on its row. This sets its start and end dates, replacing any it already had.
*   To move a bar, drag it along its row. To change its start or end date, drag one of its edges.
*   To see or edit a note in place, click its bar or its title in the left column.
*   To change the scale, use the _Week_, _Month_ and _Year_ buttons. The timeline remembers the last one used. Bars snap to whole days at every scale.
*   To move through time, use the <span class="tn-icon bx bx-chevron-left"></span> and <span class="tn-icon bx bx-chevron-right"></span> buttons, or _Today_ to come back to the current date.

## Dates

A note is placed on the timeline by the following labels:

| Label | Description |
| --- | --- |
| `#startDate` | The date the bar starts on, in `YYYY-MM-DD` format. Required for the note to have a bar. |
| `#endDate` | The date the bar ends on, inclusive. Without it, the bar covers a single day. |
| `#startTime`, `#endTime` | Optional times of day, as in the <a class="reference-link" href="Calendar.md">Calendar</a>. |

The labels that hold the dates can be changed with `#calendar:startDate`, `#calendar:endDate`, `#calendar:startTime` and `#calendar:endTime`, the same as in the Calendar.

## Limitations

*   Bars can only be moved along their own row; dragging a bar onto another row is not possible.
*   Dependencies between notes and progress are not displayed.

## Under the hood

The Timeline is built on the resource timeline of [FullCalendar](https://fullcalendar.io/) Premium, which Trilium uses under its AGPLv3 license.