# Calendar
<figure class="image image-style-align-center"><img style="aspect-ratio:767/606;" src="4_Calendar_image.png" width="767" height="606"></figure>

The Calendar view will display each child note in a calendar that has a start date and optionally an end date, as an event.

The Calendar view has multiple display modes:

*   Week view, where all the 7 days of the week (or 5 if the weekends are hidden) are displayed in columns. This mode allows entering and displaying time-specific events, not just all-day events.
*   Month view, where the entire month is displayed and all-day events can be inserted. Both time-specific events and all-day events are listed.
*   Year view, which displays the entire year for quick reference.
*   List view, which displays all the events of a given month in sequence.

Unlike other Collection view types, the Calendar view also allows some kind of interaction, such as moving events around as well as creating new ones.

## Creating a calendar

|     |     |     |
| --- | --- | --- |
| 1   | ![](2_Calendar_image.png) | The Calendar View works only for Collection note types. To create a new note, right click on the note tree on the left and select Insert note after, or Insert child note and then select _Collection_. |
| 2   | ![](3_Calendar_image.png) | Once created, the “View type” of the Collection needs changed to “Calendar”, by selecting the “Collection Properties” tab in the ribbon. |

## Creating a new event/note

*   Clicking on a day will create a new child note and assign it to that particular day.
    *   You will be asked for the name of the new note. If the popup is dismissed by pressing the close button or escape, then the note will not be created.
*   It's possible to drag across multiple days to set both the start and end date of a particular note.  
    ![](Calendar_image.png)
*   Creating new notes from the calendar will respect the `~child:template` relation if set on the Collection note.

## Interacting with events

*   Hovering the mouse over an event will display information about the note.  
    ![](7_Calendar_image.png)
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

<table><thead><tr><th>Name</th><th>Description</th></tr></thead><tbody><tr><td><code>#calendar:hideWeekends</code></td><td>When present (regardless of value), it will hide Saturday and Sundays from the calendar.</td></tr><tr><td><code>#calendar:weekNumbers</code></td><td>When present (regardless of value), it will show the number of the week on the calendar.</td></tr><tr><td><code>#calendar:initialDate</code></td><td>Change the date the calendar opens on. When not present, the calendar opens on the current date.</td></tr><tr><td><code>#calendar:view</code></td><td><p>Which view to display in the calendar:</p><ul><li data-list-item-id="e2cd230dc41f41fe91ee74d7d1fa87372"><code>timeGridWeek</code> for the <em>week</em> view;</li><li data-list-item-id="eee1dba4c6cc51ebd53d0a0dd52044cd6"><code>dayGridMonth</code> for the <em>month</em> view;</li><li data-list-item-id="ed8721a76a1865dac882415f662ed45b9"><code>multiMonthYear</code> for the <em>year</em> view;</li><li data-list-item-id="edf09a13759102d98dac34c33eb690c05"><code>listMonth</code> for the <em>list</em> view.</li></ul><p>Any other value will be dismissed and the default view (month) will be used instead.</p><p>The value of this label is automatically updated when changing the view using the UI buttons.</p></td></tr><tr><td><code>~child:template</code></td><td>Defines the template for newly created notes in the calendar (via dragging or clicking).</td></tr></tbody></table>

In addition, the first day of the week can be either Sunday or Monday and can be adjusted from the application settings.

## Configuring the calendar events using attributes

For each note of the calendar, the following attributes can be used:

| Name | Description |
| --- | --- |
| `#startDate` | The date the event starts, which will display it in the calendar. The format is `YYYY-MM-DD` (year, month and day separated by a minus sign). |
| `#endDate` | Similar to `startDate`, mentions the end date if the event spans across multiple days. The date is inclusive, so the end day is also considered. The attribute can be missing for single-day events. |
| `#startTime` | The time the event starts at. If this value is missing, then the event is considered a full-day event. The format is `HH:MM` (hours in 24-hour format and minutes). |
| `#endTime` | Similar to `startTime`, it mentions the time at which the event ends (in relation with `endDate` if present, or `startDate`). |
| `#color` | Displays the event with a specified color (named such as `red`, `gray` or hex such as `#FF0000`). This will also change the color of the note in other places such as the note tree. |
| `#calendar:color` | **❌️ Removed since v0.100.0. Use** `**#color**` **instead.**  <br>  <br>Similar to `#color`, but applies the color only for the event in the calendar and not for other places such as the note tree. |
| `#iconClass` | If present, the icon of the note will be displayed to the left of the event title. |
| `#calendar:title` | Changes the title of an event to point to an attribute of the note other than the title, can either a label or a relation (without the `#` or `~` symbol). See _Use-cases_ for more information. |
| `#calendar:displayedAttributes` | Allows displaying the value of one or more attributes in the calendar like this:       <br>  <br>![](9_Calendar_image.png)      <br>  <br>`#weight="70" #Mood="Good" #calendar:displayedAttributes="weight,Mood"`     <br>  <br>It can also be used with relations, case in which it will display the title of the target note:      <br>  <br>`~assignee=@My assignee #calendar:displayedAttributes="assignee"` |
| `#calendar:startDate` | Allows using a different label to represent the start date, other than `startDate` (e.g. `expiryDate`). The label name **must not be** prefixed with `#`. If the label is not defined for a note, the default will be used instead. |
| `#calendar:endDate` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end date. |
| `#calendar:startTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the start time. |
| `#calendar:endTime` | Similar to `#calendar:startDate`, allows changing the attribute which is being used to read the end time. |

## How the calendar works

![](11_Calendar_image.png)

The calendar displays all the child notes of the Collection that have a `#startDate`. An `#endDate` can optionally be added.

If editing the start date and end date from the note itself is desirable, the following attributes can be added to the Collection note:

```
#viewType=calendar #label:startDate(inheritable)="promoted,alias=Start Date,single,date"
#label:endDate(inheritable)="promoted,alias=End Date,single,date"
#hidePromotedAttributes 
```

This will result in:

![](10_Calendar_image.png)

When not used in a Journal, the calendar is recursive. That is, it will look for events not just in its child notes but also in the children of these child notes.

## Use-cases

### Using with the Journal / calendar

It is possible to integrate the calendar view into the Journal with day notes. In order to do so change the note type of the Journal note (calendar root) to Collection and then select the Calendar View.

Based on the `#calendarRoot` (or `#workspaceCalendarRoot`) attribute, the calendar will know that it's in a calendar and apply the following:

*   The calendar events are now rendered based on their `dateNote` attribute rather than `startDate`.
*   Interactive editing such as dragging over an empty era or resizing an event is no longer possible.
*   Clicking on the empty space on a date will automatically open that day's note or create it if it does not exist.
*   Direct children of a day note will be displayed on the calendar despite not having a `dateNote` attribute. Children of the child notes will not be displayed.

<img src="8_Calendar_image.png" width="1217" height="724">

### Using a different attribute as event title

By default, events are displayed on the calendar by their note title. However, it is possible to configure a different attribute to be displayed instead.

To do so, assign `#calendar:title` to the child note (not the calendar/Collection note), with the value being `name` where `name` can be any label (make not to add the `#` prefix). The attribute can also come through inheritance such as a template attribute. If the note does not have the requested label, the title of the note will be used instead.

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#startDate=2025-02-11 #endDate=2025-02-13 #name="My vacation" #calendar:title="name"</code></pre></td><td><p>&nbsp;</p><figure class="image image-style-align-center"><img style="aspect-ratio:445/124;" src="5_Calendar_image.png" width="445" height="124"></figure></td></tr></tbody></table>

### Using a relation attribute as event title

Similarly to using an attribute, use `#calendar:title` and set it to `name` where `name` is the name of the relation to use.

Moreover, if there are more relations of the same name, they will be displayed as multiple events coming from the same note.

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#startDate=2025-02-14 #endDate=2025-02-15 ~for=@John Smith ~for=@Jane Doe #calendar:title="for"</code></pre></td><td><img src="6_Calendar_image.png" width="294" height="151"></td></tr></tbody></table>

Note that it's even possible to have a `#calendar:title` on the target note (e.g. “John Smith”) which will try to render an attribute of it. Note that it's not possible to use a relation here as well for safety reasons (an accidental recursion  of attributes could cause the application to loop infinitely).

<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td><pre><code class="language-text-x-trilium-auto">#calendar:title="shortName" #shortName="John S."</code></pre></td><td><figure class="image image-style-align-center"><img style="aspect-ratio:296/150;" src="1_Calendar_image.png" width="296" height="150"></figure></td></tr></tbody></table>