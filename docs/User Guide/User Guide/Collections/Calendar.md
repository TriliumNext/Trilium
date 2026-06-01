# Calendar
<figure class="image image-style-align-center"><img style="aspect-ratio:767/606;" src="2_Calendar_image.png" width="767" height="606"></figure>

The Calendar view will display each child note in a calendar that has a start date and optionally an end date, as an event.

The Calendar view has multiple display modes:

*   Week view, where all the 7 days of the week (or 5 if the weekends are hidden) are displayed in columns. This mode allows entering and displaying time-specific events, not just all-day events.
*   Month view, where the entire month is displayed and all-day events can be inserted. Both time-specific events and all-day events are listed.
*   Year view, which displays the entire year for quick reference.
*   List view, which displays all the events of a given month in sequence.

Unlike other Collection view types, the Calendar view also allows some kind of interaction, such as moving events around as well as creating new ones.

## Creating a calendar

Right click on an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_ and look for _Calendar_.

## Creating a new event/note

*   Clicking on a day will create a new child note and assign it to that particular day.
    *   You will be asked for the name of the new note. If the popup is dismissed by pressing the close button or escape, then the note will not be created.
*   It's possible to drag across multiple days to set both the start and end date of a particular note.  
    ![](Calendar_image.png)
*   Creating new notes from the calendar will respect the `~child:template` relation if set on the Collection note.

## Interacting with events

*   Hovering the mouse over an event will display information about the note.  
    ![](5_Calendar_image.png)
*   Left clicking the event will open a <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a> to edit the note in a popup while allowing easy return to the calendar by just dismissing the popup.
    *   Middle clicking will open the note in a new tab.
    *   Right click will offer more options including opening the note in a new split or window.
*   Drag and drop an event on the calendar to move it to another day.
*   The length of an event can be changed by placing the mouse to the right edge of the event and dragging the mouse around.

## Interaction on mobile

When Trilium is on mobile, the interaction with the calendar is slightly different:

*   Clicking on an event triggers the contextual menu, including the option to open in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>.
*   To insert a new event, touch and hold the empty space. When successful, the empty space will become colored to indicate the selection.
    *   Before releasing, drag across multiple spaces to create multi-day events.
    *   When released, a prompt will appear to enter the note title.
*   To move an existing event, touch and hold the event until the empty space near it will become colored.
    *   At this point the event can be dragged across other days on the calendar.
    *   Or the event can be resized by tapping on the small circle to the right end of the event.
    *   To exit out of editing mode, simply tap the empty space anywhere on the calendar.

## Configuring the calendar view

In the _Collections_ tab in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>, it's possible to adjust the following:

*   Hide weekends from the week view.
*   Display week numbers on the calendar.

## Configuring the calendar using attributes

The following attributes can be added to the Collection type:

<table>
    <thead>
        <tr>
            <th>Name</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code spellcheck="false">#calendar:hideWeekends</code></td>
            <td>When present (regardless of value), it will hide Saturday and Sundays from the calendar.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:weekNumbers</code></td>
            <td>When present (regardless of value), it will show the number of the week on the calendar.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:initialDate</code></td>
            <td>Change the date the calendar opens on. When not present, the calendar opens on the current date.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:view</code></td>
            <td>
                <p>Which view to display in the calendar:</p>
                <ul>
                    <li data-list-item-id="e2cd230dc41f41fe91ee74d7d1fa87381"><code spellcheck="false">timeGridDay</code> for the <em>day</em> view;</li>
                    <li data-list-item-id="e2cd230dc41f41fe91ee74d7d1fa87372"><code spellcheck="false">timeGridWeek</code> for the <em>week</em> view;</li>
                    <li data-list-item-id="eee1dba4c6cc51ebd53d0a0dd52044cd6"><code spellcheck="false">dayGridMonth</code> for the <em>month</em> view;</li>
                    <li data-list-item-id="ed8721a76a1865dac882415f662ed45b9"><code spellcheck="false">multiMonthYear</code> for the <em>year</em> view;</li>
                    <li data-list-item-id="edf09a13759102d98dac34c33eb690c05"><code spellcheck="false">listMonth</code> for the <em>list</em> view.</li>
                </ul>
                <p>Any other value will be dismissed and the default view (month) will be used instead.</p>
                <p>The value of this label is automatically updated when changing the view using the UI buttons.</p>
            </td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:slotDuration</code></td>
            <td>Sets how long each timeslot is on the calendar. Defaults to <code>00:30:00</code> (30 minutes). Must have the format "HH:MM:SS". For example, to create timeslots for every 10 minutes, you would set <code spellcheck="false">#calendar:slotDuration="00:10:00"</code>.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:slotLabelInterval</code></td>
            <td>Sets how often the timeslots on the calendar should be labeled. Defaults to <code>01:00:00</code> (1 hour). Must have the format "HH:MM:SS". For example, to label timeslots every 30 minutes, you would set <code spellcheck="false">#calendar:slotLabelInterval="00:30:00"</code>.</td>        </tr>
        <tr>
            <td><code spellcheck="false">~child:template</code></td>
            <td>Defines the template for newly created notes in the calendar (via dragging or clicking).</td>
        </tr>
    </tbody>
</table>


In addition, the first day of the week can be either Sunday or Monday and can be adjusted from the application settings.

## Configuring the calendar events using attributes

For each note of the calendar, the following attributes can be used:

| Name | Description |
| --- | --- |
| `#startDate` | The date the event starts, which will display it in the calendar. The format is `YYYY-MM-DD` (year, month and day separated by a minus sign). |
| `#endDate` | Similar to `startDate`, mentions the end date if the event spans across multiple days. The date is inclusive, so the end day is also considered. The attribute can be missing for single-day events. |
| `#startTime` | The time the event starts at. If this value is missing, then the event is considered a full-day event. The format is `HH:MM` (hours in 24-hour format and minutes). |
| `#endTime` | Similar to `startTime`, it mentions the time at which the event ends (in relation with `endDate` if present, or `startDate`). |
| `#recurrence` | This is an optional CalDAV `RRULE` string that if present, determines whether a task should repeat or not. Note that it does not include the `DTSTART` attribute, which is derived from the `#startDate` and `#startTime` directly. For examples of valid `RRULE` strings see [https://icalendar.org/rrule-tool.html](https://icalendar.org/rrule-tool.html) |
| `#color` | Displays the event with a specified color (named such as `red`, `gray` or hex such as `#FF0000`). This will also change the color of the note in other places such as the note tree. |
| `#calendar:color` | **❌️ Removed since v0.100.0. Use** `**#color**` **instead.**    <br>  <br>Similar to `#color`, but applies the color only for the event in the calendar and not for other places such as the note tree. |
| `#iconClass` | If present, the icon of the note will be displayed to the left of the event title. |
| `#calendar:title` | Changes the title of an event to point to an attribute of the note other than the title, can either a label or a relation (without the `#` or `~` symbol). See _Use-cases_ for more information. |
| `#calendar:displayedAttributes` | Allows displaying the value of one or more attributes in the calendar like this:         <br>  <br>![](7_Calendar_image.png)        <br>  <br>`#weight="70" #Mood="Good" #calendar:displayedAttributes="weight,Mood"`       <br>  <br>It can also be used with relations, case in which it will display the title of the target note:        <br>  <br>`~assignee=@My assignee #calendar:displayedAttributes="assignee"` |
| `#calendar:startDate` | Allows using a different label to represent the start date, other than `startDate` (e.g. `expiryDate`). The label name **must not be** prefixed with `#`. If the label is not defined for a note, the default will be used instead. |
| `#calendar:endDate` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end date. |
| `#calendar:startTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the start time. |
| `#calendar:endTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end time. |

## How the calendar works

![](9_Calendar_image.png)

The calendar displays all the child notes of the Collection that have a `#startDate`. An `#endDate` can optionally be added.

If editing the start date and end date from the note itself is desirable, the following attributes can be added to the Collection note:

```
#viewType=calendar #label:startDate(inheritable)="promoted,alias=Start Date,single,date"
#label:endDate(inheritable)="promoted,alias=End Date,single,date"
#hidePromotedAttributes 
```

This will result in:

![](8_Calendar_image.png)

When not used in a Journal, the calendar is recursive. That is, it will look for events not just in its child notes but also in the children of these child notes.

## Recurrence

The built in calendar view also supports repeating tasks. If a child note of the calendar has a #recurrence label with a valid recurrence, that event will repeat on the calendar according to the recurrence string. 

For example, to make a note repeat on the calendar:

*   Every Day - `#recurrence="FREQ=DAILY;INTERVAL=1"`
*   Every 3 days - `#recurrence="FREQ=DAILY;INTERVAL=3"`
*   Every week - `#recurrence="FREQ=WEEKLY;INTERVAL=1"`
*   Every 2 weeks on Monday, Wednesday and Friday - `#recurrence="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR"`
*   Every 3 months - `#recurrence="FREQ=MONTHLY;INTERVAL=3"`
*   Every 2 months on the First Sunday - `#recurrence="FREQ=MONTHLY;INTERVAL=2;BYDAY=1SU"`
*   Every month on the Last Friday - `#recurrence="FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR"`
*   And so on.

For other examples of valid `RRULE` strings see [https://icalendar.org/rrule-tool.html](https://icalendar.org/rrule-tool.html)

Note that the recurrence string does not include the `DTSTART` attribute as defined in the iCAL specifications. This is derived directly from the `startDate` and `startTime` attributes

If you want to override the label the calendar uses to fetch the recurrence string, you can use the `#calendar:recurrence` attribute. For example, you can set `#calendar:recurrence=taskRepeats`. Then you can set your recurrence string like `#taskRepeats="FREQ=DAILY;INTERVAL=1"`

Also note that the recurrence label can be made promoted as with the start and end dates. 

> [!WARNING]
> If the recurrence string is not valid, a toast will be shown with the note ID and title of the note with the erroneous recurrence message. This note will not be added to the calendar


## Slot Duration & Slot Label Interval

Trilium's calendar view is powered by FullCalendar, which gives you fine-grained control over how the time grid looks and behaves for day and week views. Two labels you can use to configure these views are `#slotDuration` and `#slotLabelInterval`. Understanding what each one does — and how they interact — lets you tailor the calendar to match your workflow, whether you're scheduling in 15-minute increments or planning out your day in broad hourly blocks.

### `slotDuration`

Controls how tall each time slot is on the calendar — essentially the smallest unit of time the grid is divided into. A shorter duration means more rows and finer granularity; a longer one means fewer, chunkier rows. The default is one row every 15 minutes

**Examples:**

| Value | Result |
|---|---|
| `#slotDuration="00:15:00"` | One row every 15 minutes |
| `#slotDuration="00:30:00"` | One row every 30 minutes |
| `#slotDuration="01:00:00"` | One row every hour |


### `slotLabelInterval`

Controls how often a time label appears on the left-hand axis. This is independent of the slot size — you can have very small slots but only label every hour to keep the axis readable. The default is a time label shown every hour.

**Examples:**

| Value | Result |
|---|---|
| `slotLabelInterval="00:30:00"` | Show a time label every 30 minutes |
| `slotLabelInterval="01:00:00"` | Show a time label every hour |



### Useful combinations

| `slotDuration` | `slotLabelInterval` | Result |
|---|---|---|
| `00:15:00` | `01:00:00` | Fine grid, clean axis — good for busy schedules |
| `00:30:00` | `01:00:00` | Standard calendar feel |
| `01:00:00` | `01:00:00` | Simple hourly grid — good for day planning |
| `00:15:00` | `00:30:00` | Fine grid, labels every 30 min — balanced detail |

### Format

Both values use `HH:mm:ss` format. Hours can go up to `24` (`24:00:00`), while minutes and seconds must be between `00` and `59`. The minimum meaningful duration is 1 minute (`00:01:00`).

### Examples

#### `#slotDuration="00:05:00"` — `#slotLabelInterval="00:30:00"`

Slots every 5 minutes, but only labelled every 30 minutes. Useful for very precise scheduling without a cluttered axis.

| Axis | Time |
|---|---|
| **9:00** | 9:00 |
|  | 9:05 |
|  | 9:10 |
|  | 9:15 |
|  | 9:20 |
|  | 9:25 |
| **9:30** | 9:30 |
|  | 9:35 |
|  | 9:40 |
|  | 9:45 |
|  | 9:50 |
|  | 9:55 |
| **10:00** | 10:00 |
|  | 10:05 |
|  | 10:10 |
|  | 10:15 |
|  | 10:20 |
|  | 10:25 |
| **10:30** | 10:30 |
|  | 10:35 |
|  | 10:40 |
|  | 10:45 |
|  | 10:50 |
|  | 10:55 |

---

#### `#slotDuration="00:15:00"` — `#slotLabelInterval="01:00:00"`

Slots every 15 minutes, but only labelled on the hour. A good balance between granularity and readability.

| Axis | Time |
|---|---|
| **9:00** | 9:00 |
|  | 9:15 |
|  | 9:30 |
|  | 9:45 |
| **10:00** | 10:00 |
|  | 10:15 |
|  | 10:30 |
|  | 10:45 |
| **11:00** | 11:00 |
|  | 11:15 |
|  | 11:30 |
|  | 11:45 |
| **12:00** | 12:00 |
|  | 12:15 |
|  | 12:30 |


## Use-cases

### Using with the Journal / calendar

It is possible to integrate the calendar view into the Journal with day notes. In order to do so change the note type of the Journal note (calendar root) to Collection and then select the Calendar View.

Based on the `#calendarRoot` (or `#workspaceCalendarRoot`) attribute, the calendar will know that it's in a calendar and apply the following:

*   The calendar events are now rendered based on their `dateNote` attribute rather than `startDate`.
*   Interactive editing such as dragging over an empty era or resizing an event is no longer possible.
*   Clicking on the empty space on a date will automatically open that day's note or create it if it does not exist.
*   Direct children of a day note will be displayed on the calendar despite not having a `dateNote` attribute. Children of the child notes will not be displayed.

<img src="6_Calendar_image.png" width="1217" height="724">

### Using a different attribute as event title

By default, events are displayed on the calendar by their note title. However, it is possible to configure a different attribute to be displayed instead.

To do so, assign `#calendar:title` to the child note (not the calendar/Collection note), with the value being `name` where `name` can be any label (make not to add the `#` prefix). The attribute can also come through inheritance such as a template attribute. If the note does not have the requested label, the title of the note will be used instead.

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#startDate=2025-02-11 #endDate=2025-02-13 #name="My vacation" #calendar:title="name"</code></pre></td><td><p>&nbsp;</p><figure class="image image-style-align-center"><img style="aspect-ratio:445/124;" src="3_Calendar_image.png" width="445" height="124"></figure></td></tr></tbody></table>

### Using a relation attribute as event title

Similarly to using an attribute, use `#calendar:title` and set it to `name` where `name` is the name of the relation to use.

Moreover, if there are more relations of the same name, they will be displayed as multiple events coming from the same note.

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#startDate=2025-02-14 #endDate=2025-02-15 ~for=@John Smith ~for=@Jane Doe #calendar:title="for"</code></pre></td><td><img src="4_Calendar_image.png" width="294" height="151"></td></tr></tbody></table>

Note that it's even possible to have a `#calendar:title` on the target note (e.g. “John Smith”) which will try to render an attribute of it. Note that it's not possible to use a relation here as well for safety reasons (an accidental recursion  of attributes could cause the application to loop infinitely).

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#calendar:title="shortName" #shortName="John S."</code></pre></td><td><figure class="image image-style-align-center"><img style="aspect-ratio:296/150;" src="1_Calendar_image.png" width="296" height="150"></figure></td></tr></tbody></table>