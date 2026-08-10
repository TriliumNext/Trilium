# Day Notes
A common pattern in note-taking is that a lot of notes will be centered around a certain date - e.g. you have some tasks which needs to be done on a certain date, you have meeting minutes from a certain date, you have your thoughts etc. and it all revolves around a date on which they occurred. For this reason, it makes sense to create a certain "day workspace" which will centralize all those notes relevant for a certain date.

For this, Trilium provides a concept of "day note". Trilium semi-automatically generates a single note for each day. Under this note you can save all those relevant notes.

Select an existing day note, and the menubar contains a calendar widget. Select any day to create a note for that day. 

![](1_Day%20Notes_image.jpg)

This pattern works well also because of [Cloning Notes](../../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) functionality - note can appear in multiple places in the note tree, so besides appearing under day note, it can also be categorized into other notes.

## Demo

![](Day%20Notes_image.png)

You can see the structure of day notes appearing under "Journal" note - there's a note for the whole year 2025, under it, you have "03 - March" which then contains "09 - Monday". This is our "day note" which contains some text in its content and also has some child notes (some of them are from [Task manager](Task%20Manager.md)).

You can also notice how this day note has [promoted attribute](../Attributes/Promoted%20Attributes.md) "weight" where you can track your daily weight. This data is then used in [Weight tracker](Weight%20Tracker.md).

## Week Note and Quarter Note

Week and quarter notes are disabled by default, since it might be too much for some people. To enable them, you need to set `#enableWeekNote` and `#enableQuarterNote` attributes on the root calendar note, which is identified by `#calendarRoot` label. Week note is affected by the first week of year option. Be careful when you already have some week notes created, it will not automatically change the existing week notes and might lead to some duplicates.

## Templates

Trilium provides [template](../Templates.md) functionality, and it could be used together with day notes.

You can define one of the following relations on the root of the journal (identified by `#calendarRoot` label):

*   yearTemplate
*   quarterTemplate (if `#enableQuarterNote` is set)
*   monthTemplate
*   weekTemplate (if `#enableWeekNote` is set)
*   dateTemplate

All of these are relations. When Trilium creates a new note for year or month or date, it will take a look at the root and attach a corresponding `~template` relation to the newly created role. Using this, you can e.g. create your daily template with e.g. checkboxes for daily routine etc.

### Migrate from old template usage

If you have been using Journal prior to version v0.93.0, the previous template pattern likely used was `~child:template=`.  
To transition to the new system:

1.  Set up the new template pattern in the Calendar root note.
2.  Use [Bulk Actions](../Bulk%20Actions.md) to remove `child:template` and `child:child:template` from all notes under the Journal (calendar root).
3.  Ensure that all old template patterns are fully removed to prevent conflicts with the new setup.

## Naming pattern

You can customize the title of generated journal notes by defining a `#datePattern`, `#weekPattern`, `#monthPattern`, `#quarterPattern` and `#yearPattern` attribute on a root calendar note (identified by `#calendarRoot` label). The naming pattern replacements follow a level-up compatibility - each level can use replacements from itself and all levels above it. For example, `#monthPattern` can use month, quarter and year replacements, while `#weekPattern` can use week, month, quarter and year replacements. But it is not possible to use week replacements in `#monthPattern`.

### Date pattern

It's possible to customize the title of generated date notes by defining a `#datePattern` attribute on a root calendar note (identified by `#calendarRoot` label). Following are possible values:

*   `{isoDate}` results in an ISO 8061 formatted date (e.g. "2025-03-09" for March 9, 2025)
*   `{dateNumber}` results in a number like `9` for the 9th day of the month, `11` for the 11th day of the month
*   `{dateNumberPadded}` results in a number like `09` for the 9th day of the month, `11` for the 11th day of the month
*   `{ordinal}` is replaced with the ordinal date (e.g. 1st, 2nd, 3rd) etc.
*   `{weekDay}` results in the full day name (e.g. `Monday`)
*   `{weekDay3}` is replaced with the first 3 letters of the day, e.g. Mon, Tue, etc.
*   `{weekDay2}` is replaced with the first 2 letters of the day, e.g. Mo, Tu, etc.

The default is `{dateNumberPadded} - {weekDay}`

### Week pattern

It is also possible to customize the title of generated week notes through the `#weekPattern` attribute on the root calendar note. The options are:

*   `{weekNumber}` results in a number like `9` for the 9th week of the year, `11` for the 11th week of the year
*   `{weekNumberPadded}` results in a number like `09` for the 9th week of the year, `11` for the 11th week of the year
*   `{shortWeek}` results in a short week string like `W9` for the 9th week of the year, `W11` for the 11th week of the year
*   `{shortWeek3}` results in a short week string like `W09` for the 9th week of the year, `W11` for the 11th week of the year

The default is `Week {weekNumber}`

### Month pattern

It is also possible to customize the title of generated month notes through the `#monthPattern` attribute on the root calendar note. The options are:

*   `{isoMonth}` results in an ISO 8061 formatted month (e.g. "2025-03" for March 2025)
*   `{monthNumber}` results in a number like `9` for September, and `11` for November
*   `{monthNumberPadded}` results in a number like `09` for September, and `11` for November
*   `{month}` results in the full month name (e.g. `September` or `October`)
*   `{shortMonth3}` is replaced with the first 3 letters of the month, e.g. Jan, Feb, etc.
*   `{shortMonth4}` is replaced with the first 4 letters of the month, e.g. Sept, Octo, etc.

The default is `{monthNumberPadded} - {month}`

### Quarter pattern

It is also possible to customize the title of generated quarter notes through the `#quarterPattern` attribute on the root calendar note. The options are:

*   `{quarterNumber}` results in a number like `1` for the 1st quarter of the year
*   `{shortQuarter}` results in a short quarter string like `Q1` for the 1st quarter of the year

The default is `Quarter {quarterNumber}`

### Year pattern

It is also possible to customize the title of generated year notes through the `#yearPattern` attribute on the root calendar note. The options are:

*   `{year}` results in the full year (e.g. `2025`)

The default is `{year}`

## Implementation

Trilium has some special support for day notes in the form of [backend Script API](https://triliumnext.github.io/Notes/backend_api/BackendScriptApi.html) - see e.g. getDayNote() function.

Day (and year, month) notes are created with a label - e.g. `#dateNote="2025-03-09"` this can then be used by other scripts to add new notes to day note etc.