---
type: improvement
area: Calendar
closes: [11601]
notable: true
---

The calendar collection catches up with the board: a properties dialog, attributes on events, and recurring events that [know their age](https://github.com/TriliumNext/Trilium/pull/11601).

*   The Calendar properties dialog lists the calendar's settings (hidden weekends, week numbers, time slots, archived notes) and its event templates in one place, and an Event attributes card chooses which attributes the events show and in what order. Attributes nobody has arranged stay off the events, so existing calendars keep their current chips.
*   The event context menu sets an event's attributes in place, as a board card's does, so a flag, state or date changes without opening the note.
*   A yearly event can show how many years it has recurred: with Yearly selected, the Repeats dropdown offers "Show the number of years in the title", which writes `#calendar:titleTemplate="${title} (${years})"` on the event. A birthday entered once in 1990 reads "Ana's birthday (36)" in 2026 and counts up every year.
*   Routine events (a daily stand-up, lunch) can be hidden from the month, year and list views through the properties dialog.
