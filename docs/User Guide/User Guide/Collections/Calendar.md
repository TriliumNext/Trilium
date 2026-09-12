# Calendar
<figure class="image"><img style="aspect-ratio:2016/1413;" src="1_Calendar_image.png" width="2016" height="1413"></figure>

The Calendar view will display each child note in a calendar that has a start date and optionally an end date, as an event.

The Calendar view has multiple display modes:

*   Month view, where the entire month is displayed and all-day events can be inserted. Both time-specific events and all-day events are listed.
*   Week view, where all the 7 days of the week (or 5 if the weekends are hidden) are displayed in columns. This mode allows entering and displaying time-specific events, not just all-day events.
*   Day view, which views only a single day. Especially useful for heavy agendas or mobile views.
*   List view, which displays all the events of a given month in sequence.
*   Year view, which displays the entire year for quick reference.

Unlike other Collection view types, the Calendar view also allows some kind of interaction, such as moving events around as well as creating new ones.

## Creating a calendar

Right click on an existing note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> and select _Insert child note_ and look for _Calendar_.

## Creating a new event/note

To create a new event:

*   First, click the desired day (month & year views) or the desired timeslot (day view).
*   Alternatively, drag across multiple days (or time slots) to set both the start and end date.

In either cases, a small popup will show with a prompt for a title and the date & time of the event that will be created.

At this point, the event hasn't been created yet to protect against accidental clicks. Add a title optionally and press the _Create_ button. If no title is provided, the event will follow the <a class="reference-link" href="../Advanced%20Usage/Default%20Note%20Title.md">Default Note Title</a> rules.

After creating the event, it will show up on the calendar. To edit the content of the event (including recurrence), click on it to bring it into the popup view.

> [!NOTE]
> Creating new notes from the calendar will respect the `~child:template` relation if set on the Collection note.

## Interacting with events

*   Hovering the mouse over an event will display information about the note.  
    ![](4_Calendar_image.png)
*   Left clicking the event will open a dedicated popup to quickly configure the event or edit its note content.
*   Right click will offer more options including opening the note in a new split or window.
*   Drag and drop an event on the calendar to move it to another day.
*   The length of an event can be changed by placing the mouse to the right edge of the event and dragging the mouse around.

### Popup view

When an event is clicked, a popup will show near the event which contains the following inforamtion:

*   The title and icon of the event, both editable.
*   Buttons to interact with the event:
    *   Open the event in the same pane, new tab, etc.
    *   Color picker to change the color of the event.
    *   Button to remove the event from the calendar, which can optionally delete its corresponding note.
*   Calendar-specific features:
    *   A toggle for all-day events.
    *   A start/end date & time selector.
    *   A full recurrence editor, to have the same event show up weekly, monthly, etc.
*   The <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> of the marker, if any.
*   The note's content which can be edited directly from the panel.

To dismiss the popup:

*   Press the X button at the top-right of the popup.
*   In the calendar, press anywhere outside the popup.
*   Or simply press the <kbd>Escape</kbd> key.

It is possible to switch between events by clicking on them even when the popup view is already open.

Events can have <a class="reference-link" href="../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> between them and clicking on such a link will automatically navigate the calendar to the right date and the popup view to the new note.

## Interaction on mobile

When Trilium is on mobile, the interaction with the calendar is slightly different:

*   Clicking on an event displays the popup view, which allows editing the event.
*   Long-presing an event triggers the contextual menu, including the option to open in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>.
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
*   Set the slot duration (the length of each time row in day/week view).
*   Set the slot label interval (how often time labels appear on the axis in day/week view).

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
            <td><p>Which view to display in the calendar:</p><ul><li><code spellcheck="false">timeGridDay</code> for the <em>day</em> view;</li><li><code spellcheck="false">timeGridWeek</code> for the <em>week</em> view;</li><li><code spellcheck="false">dayGridMonth</code> for the <em>month</em> view;</li><li><code spellcheck="false">multiMonthYear</code> for the <em>year</em> view;</li><li><code spellcheck="false">listMonth</code> for the <em>list</em> view.</li></ul><p>Any other value will be dismissed and the default view (month) will be used instead.</p><p>The value of this label is automatically updated when changing the view using the UI buttons.</p></td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:slotDuration</code></td>
            <td>Sets how long each timeslot is on the calendar. Defaults to <code spellcheck="false">00:15:00</code> (15 minutes). Must have the format "HH:MM:SS". For example, to create timeslots for every 10 minutes, you would set <code spellcheck="false">#calendar:slotDuration="00:10:00"</code>.</td>
        </tr>
        <tr>
            <td><code spellcheck="false">#calendar:slotLabelInterval</code></td>
            <td>Sets how often the timeslots on the calendar should be labeled. Defaults to <code spellcheck="false">01:00:00</code> (1 hour). Must have the format "HH:MM:SS". For example, to label timeslots every 30 minutes, you would set <code spellcheck="false">#calendar:slotLabelInterval="00:30:00"</code>.</td>
        </tr>
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
| `#calendar:color` | **❌️ Removed since v0.100.0. Use** `#color` **instead.**      <br>  <br>Similar to `#color`, but applies the color only for the event in the calendar and not for other places such as the note tree. |
| `#iconClass` | If present, the icon of the note will be displayed to the left of the event title. |
| `#calendar:title` | Changes the title of an event to point to an attribute of the note other than the title, can either a label or a relation (without the `#` or `~` symbol). See _Use-cases_ for more information. |
| `#calendar:displayedAttributes` | Allows displaying the value of one or more attributes in the calendar like this:           <br>  <br>![](6_Calendar_image.png)          <br>  <br>`#weight="70" #Mood="Good" #calendar:displayedAttributes="weight,Mood"`         <br>  <br>It can also be used with relations, case in which it will display the title of the target note:          <br>  <br>`~assignee=@My assignee #calendar:displayedAttributes="assignee"` |
| `#calendar:startDate` | Allows using a different label to represent the start date, other than `startDate` (e.g. `expiryDate`). The label name **must not be** prefixed with `#`. If the label is not defined for a note, the default will be used instead. |
| `#calendar:endDate` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end date. |
| `#calendar:startTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the start time. |
| `#calendar:endTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end time. |

## How the calendar works

![](8_Calendar_image.png)

The calendar displays all the child notes of the Collection that have a `#startDate`. An `#endDate` can optionally be added.

The start date & end date can easily be edited from the calendar collection itself by clicking on the event. To edit the date while in the event note itself, the following attributes can be added to the Collection note:

```
#viewType=calendar #label:startDate(inheritable)="promoted,alias=Start Date,single,date"
#label:endDate(inheritable)="promoted,alias=End Date,single,date"
#hidePromotedAttributes 
```

This will result in:

![](7_Calendar_image.png)

When not used in a Journal, the calendar is recursive. That is, it will look for events not just in its child notes but also in the children of these child notes.

## Recurrence

The built in calendar view also supports repeating tasks (e.g. every week, every month as well as more complex recurrency rules).

Starting with v0.105.0, recurrence can be directly edited from the calendar by clicking on an event and then selecting the _Repeats_ option.

### Custom recurrence using a subset of RRULE

If the existing recurrence editor from the event popup is not sufficient, more complex rules can be manually set via the `#recurrence` label.

For example, to make a note repeat on the calendar:

*   Every Day - `#recurrence="FREQ=DAILY;INTERVAL=1"`
*   Every 3 days - `#recurrence="FREQ=DAILY;INTERVAL=3"`
*   Every week - `#recurrence="FREQ=WEEKLY;INTERVAL=1"`
*   Every 2 weeks on Monday, Wednesday and Friday - `#recurrence="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR"`
*   Every 3 months - `#recurrence="FREQ=MONTHLY;INTERVAL=3"`
*   Every 2 months on the First Sunday - `#recurrence="FREQ=MONTHLY;INTERVAL=2;BYDAY=1SU"`
*   Every month on the Last Friday - `#recurrence="FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR"`

For other examples of valid `RRULE` strings see [https://icalendar.org/rrule-tool.html](https://icalendar.org/rrule-tool.html)

Note that the recurrence string does not include the `DTSTART` attribute as defined in the iCAL specifications. This is derived directly from the `startDate` and `startTime` attributes

If you want to override the label the calendar uses to fetch the recurrence string, you can use the `#calendar:recurrence` attribute. For example, you can set `#calendar:recurrence=taskRepeats`. Then you can set your recurrence string like `#taskRepeats="FREQ=DAILY;INTERVAL=1"`

Also note that the recurrence label can be made promoted as with the start and end dates. 

> [!WARNING]
> If the recurrence string is not valid, a toast will be shown with the note ID and title of the note with the erroneous recurrence message. This note will not be added to the calendar

## Slot Duration & Slot Label Interval

Trilium's calendar view is powered by FullCalendar, which gives you fine-grained control over how the time grid looks and behaves for day and week views. Two labels you can use to configure these views are `#calendar:slotDuration` and `#calendar:slotLabelInterval`. Understanding what each one does — and how they interact — lets you tailor the calendar to match your workflow, whether you're scheduling in 15-minute increments or planning out your day in broad hourly blocks.

These settings can also be adjusted from the _Collections_ tab in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>.

### Slot duration

Controls how tall each time slot is on the calendar — essentially the smallest unit of time the grid is divided into. A shorter duration means more rows and finer granularity; a longer one means fewer, chunkier rows. The default is one row every 15 minutes.

**Examples:**

| Value | Result |
| --- | --- |
| `#calendar:slotDuration="00:15:00"` | One row every 15 minutes |
| `#calendar:slotDuration="00:30:00"` | One row every 30 minutes |
| `#calendar:slotDuration="01:00:00"` | One row every hour |

### Label interval

Controls how often a time label appears on the left-hand axis. This is independent of the slot size — you can have very small slots but only label every hour to keep the axis readable. The default is a time label shown every hour.

**Examples:**

| Value | Result |
| --- | --- |
| `#calendar:slotLabelInterval="00:30:00"` | Show a time label every 30 minutes |
| `#calendar:slotLabelInterval="01:00:00"` | Show a time label every hour |

### Useful combinations

| `#calendar:slotDuration` | `#calendar:slotLabelInterval` | Result |
| --- | --- | --- |
| `00:15:00` | `01:00:00` | Fine grid, clean axis — good for busy schedules |
| `00:30:00` | `01:00:00` | Standard calendar feel |
| `01:00:00` | `01:00:00` | Simple hourly grid — good for day planning |
| `00:15:00` | `00:30:00` | Fine grid, labels every 30 min — balanced detail |

### Format

Both values use `HH:mm:ss` format. Hours can go up to `24` (`24:00:00`), while minutes and seconds must be between `00` and `59`. The minimum meaningful duration is 1 minute (`00:01:00`).

## Use-cases

### Using with the Journal / calendar

It is possible to integrate the calendar view into the Journal with day notes. In order to do so change the note type of the Journal note (calendar root) to Collection and then select the Calendar View.

While in journal mode, the popup editor will not show dates, recurrence, colors or removal, since day notes aren't editable events.

Based on the `#calendarRoot` (or `#workspaceCalendarRoot`) attribute, the calendar will know that it's in a calendar and apply the following:

*   The calendar events are now rendered based on their `dateNote` attribute rather than `startDate`.
*   Interactive editing such as dragging over an empty era or resizing an event is no longer possible.
*   Clicking on the empty space on a date will automatically open that day's note or create it if it does not exist.
*   Direct children of a day note will be displayed on the calendar despite not having a `dateNote` attribute. Children of the child notes will not be displayed.

<img src="5_Calendar_image.png" width="1217" height="724">

### Using a different attribute as event title

<img class="image-style-align-right" src="2_Calendar_image.png" width="445" height="124">By default, events are displayed on the calendar by their note title. However, it is possible to configure a different attribute to be displayed instead.

To do so, assign `#calendar:title` to the child note (not the calendar/Collection note), with the value being `name` where `name` can be any label (make not to add the `#` prefix). The attribute can also come through inheritance such as a template attribute. If the note does not have the requested label, the title of the note will be used instead.

```
#startDate=2025-02-11 #endDate=2025-02-13 #name="My vacation" #calendar:title="name"
```

### Using a relation attribute as event title

<img class="image-style-align-right image_resized" style="aspect-ratio:294/151;width:21.22%;" src="3_Calendar_image.png" width="294" height="151">Similarly to using an attribute, use `#calendar:title` and set it to `name` where `name` is the name of the relation to use.

Moreover, if there are more relations of the same name, they will be displayed as multiple events coming from the same note.

```
#startDate=2025-02-14 #endDate=2025-02-15 ~for=@John Smith ~for=@Jane Doe #calendar:title="for"
```

<img class="image-style-align-left" src="Calendar_image.png" width="296" height="150">Note that it's even possible to have a `#calendar:title` on the target note (e.g. “John Smith”) which will try to render an attribute of it. Note that it's not possible to use a relation here as well for safety reasons (an accidental recursion  of attributes could cause the application to loop infinitely).

```
#calendar:title="shortName" #shortName="John S."
```