# Labels
A label is an [attribute](../Attributes.md) of a note which has a name and optionally a value.

## Common use cases

*   **Metadata for personal use**: Assign labels with optional values for categorization, such as `#year=1999`, `#genre="sci-fi"`, or `#author="Neal Stephenson"`. This can be combined with <a class="reference-link" href="Promoted%20Attributes.md">Promoted Attributes</a> to make their display more user-friendly.
*   **Configuration**: Labels can configure advanced features or settings (see reference below).
*   **Scripts and Plugins**: Used to tag notes with special metadata, such as the "weight" attribute in the <a class="reference-link" href="../Advanced%20Showcases/Weight%20Tracker.md">Weight Tracker</a>.

## Creating a label using the visual editor

1.  Go to the _Owned Attributes_ section in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>.
2.  Press the + button (_Add new attribute_) to the right.
3.  Select _Add new label_ for the relation.

> [!TIP]
> If you prefer keyboard shortcuts, press <kbd>Alt</kbd>+<kbd>L</kbd> while focused on a note or in the _Owned Attributes_ section to display the visual editor.

While in the visual editor:

*   Set the desired name
*   Optionally, set the value of the label. Labels can exist without a value.
*   Check _Inheritable_ if the label should be inherited by the child notes as well. See <a class="reference-link" href="Attribute%20Inheritance.md">Attribute Inheritance</a> for more information.

## Creating a label manually

In the _Owned Attributes_ section in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a>:

*   To create a label called `myLabel` with no value, simply type `#myLabel`.
*   To create a label called `myLabel` with a value `value`, simply type `#myLabel=value`.
*   If the value contains spaces, then the text must be quoted: `#myLabel="Hello world"`.
*   If the string contains quotes (regardless of whether it has spaces), then the text must be quoted with apostrophes instead: `#myLabel='Hello "world"'`.
*   To create an inheritable label called `myLabel`, simply write `#myLabel(inheritable)` for no value or `#myLabel(inheritable)=value` if there is a value.

## Predefined labels

This is a list of labels that Trilium natively supports.

> [!TIP]
> Some labels presented here end with a `*`. That means that there are multiple labels with the same prefix, consult the specific page linked in the description of that label for more information.

| Label | Description |
| --- | --- |
| `disableVersioning` | Disables automatic creation of <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a> for a particular note. Useful for e.g. large, but unimportant notes - e.g. large JS libraries used for scripting. |
| `versioningLimit` | Limits the maximum number of <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md">Note Revisions</a> for a particular note, overriding the global settings. |
| `calendarRoot` | Marks the note which should be used as root for <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Day Notes</a>. Only one should be marked as such. |
| `archived` | Hides notes from default search results and dialogs. Archived notes can optionally be hidden in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. |
| `excludeFromExport` | Excludes this note and its children when exporting. |
| `run`, `runOnInstance`, `runAtHour` | See <a class="reference-link" href="../../Scripting/Backend%20scripts/Events.md">Events</a>. |
| `disableInclusion` | Scripts with this label won't be included into parent script execution. |
| `sorted`, `sortDirection`, `sortFoldersFirst`, `sortNatural`, `sortLocale`, `top`, `bottom` | Manages automatic/permanent sorting. See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Sorting%20Notes.md">Sorting Notes</a>. |
| `hidePromotedAttributes` | Hide <a class="reference-link" href="Promoted%20Attributes.md">Promoted Attributes</a> on this note. Generally useful when defining inherited attributes, but the parent note doesn't need them. |
| `readOnly` | Marks a note to always be [read-only](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md), if it's a supported note (text, code, mermaid). |
| `autoReadOnlyDisabled` | Disables automatic [read-only mode](../../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) for the given note. |
| `appCss` | Marks CSS notes which are loaded into the Trilium application and can thus be used to modify Trilium's looks. See <a class="reference-link" href="../../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a> for more info. |
| `appTheme` | Marks CSS notes which are full Trilium themes and are thus available in Trilium options. See <a class="reference-link" href="../../Theme%20development">Theme development</a> for more information. |
| `appThemeBase` | Set to `next`, `next-light`, or `next-dark` to use the corresponding TriliumNext theme (auto, light or dark) as the base for a custom theme, instead of the legacy one. See <a class="reference-link" href="../../Theme%20development/Customize%20the%20Next%20theme.md">Customize the Next theme</a> for more information. |
| `cssClass` | Value of this label is then added as CSS class to the node representing given note in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>. This can be useful for advanced theming. Can be used in template notes. |
| `iconClass` | value of this label is added as a CSS class to the icon on the tree which can help visually distinguish the notes in the tree. Example might be bx bx-home - icons are taken from boxicons. Can be used in template notes. |
| `pageSize` | Specifies the number of items per page in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a>. |
| `customRequestHandler` | See <a class="reference-link" href="../Custom%20Request%20Handler.md">Custom Request Handler</a>. |
| `customResourceProvider` | See <a class="reference-link" href="../Custom%20Resource%20Providers.md">Custom Resource Providers</a>. |
| `widget` | Marks this note as a custom widget which will be added to the Trilium component tree. See <a class="reference-link" href="../../Scripting/Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a> for more information. |
| `searchHome` | New search notes will be created as children of this note (see <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a>). |
| `workspace` and related attributes | See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Workspaces.md">Workspaces</a>. |
| `inbox` | Default inbox location for new notes. See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20Inbox.md">Note Inbox</a> for more information. |
| `sqlConsoleHome` | Default location of <a class="reference-link" href="../Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a> saved queries. |
| `bookmarked` | Indicates this note is a [bookmark](../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md). |
| `bookmarkFolder` | Note with this label will appear in bookmarks as folder (allowing access to its children). See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">Bookmarks</a> for more information. |
| `share*` | See the attribute reference in <a class="reference-link" href="../Sharing.md">Sharing</a>. |
| `displayRelations`, `hideRelations` | Comma delimited names of relations which should be displayed/hidden in a <a class="reference-link" href="../../Note%20Types/Relation%20Map.md">Relation Map</a> (both the note type and the <a class="reference-link" href="../Note%20Map%20(Link%20map%2C%20Tree%20map).md">Note Map (Link map, Tree map)</a> general functionality). |
| `titleTemplate` | Default title of notes created as children of this note. This value is evaluated as a JavaScript string and thus can be enriched with dynamic content via the injected `now` and `parentNote` variables.  <br>  <br>See <a class="reference-link" href="../Default%20Note%20Title.md">Default Note Title</a> for more info. |
| `template` | This note will appear in the selection of available template when creating new note. See <a class="reference-link" href="../Templates.md">Templates</a> for more information. |
| `toc` | Controls the display of the <a class="reference-link" href="../../Note%20Types/Text/Table%20of%20contents.md">Table of contents</a> for a given note. `#toc` or `#toc=show` to always display the table of contents, `#toc=false` to always hide it. |
| `color` | defines color of the note in note tree, links etc. Use any valid CSS color value like 'red' or #a13d5f   <br>Note: this color may be automatically adjusted when displayed to ensure sufficient contrast with the background. |
| `keyboardShortcut` | Defines a keyboard shortcut which will immediately jump to this note. Example: 'ctrl+alt+e'. Requires frontend reload for the change to take effect. |
| `keepCurrentHoisting` | Opening this link won't change hoisting even if the note is not displayable in the current hoisted subtree. |
| `executeButton` | Title of the button which will execute the current code note |
| `executeDescription` | Longer description of the current code note displayed together with the execute button |
| `excludeFromNoteMap` | Notes with this label will be hidden from the <a class="reference-link" href="../../Note%20Types/Note%20Map.md">Note Map</a>. |
| `newNotesOnTop` | New notes will be created at the top of the parent note, not on the bottom. |
| `hideHighlightWidget` | Hides the <a class="reference-link" href="../../Note%20Types/Text/Highlights%20list.md">Highlights list</a> widget |
| `hideChildrenOverview` | Hides the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a> for that particular note. |
| `subtreeHidden` | Hides all child notes of this note from the tree, displaying a badge with the count of hidden children. Children remain accessible via search or direct links. |
| `printLandscape` | When exporting to PDF, changes the orientation of the page to landscape instead of portrait. |
| `printPageSize` | When exporting to PDF, changes the size of the page. Supported values: `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `A6`, `Legal`, `Letter`, `Tabloid`, `Ledger`. |
| `printScale`, `printMargins` | Additional printing options, generally configured through the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Printing%20%26%20Exporting%20as%20PDF.md">Printing &amp; Exporting as PDF</a> dialog. |
| `geolocation` | Indicates the latitude and longitude of a note, to be displayed in a <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>. |
| `map:*` | Defines specific options for the <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>. |
| `calendar:*` | Defines specific options for the <a class="reference-link" href="../../Collections/Calendar.md">Calendar</a>. |
| `viewType` | Sets the view of child notes (e.g. grid or list). See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a> for more information. |
| `webViewSrc` | Defines the URL of the <a class="reference-link" href="../../Note%20Types/Web%20View.md">Web View</a>. |
| `tabWidth`, `indentWithTabs`, `wrapLines` | Per-note Code editor settings: indentation width, indent with tabs vs. spaces, and word wrapping. See <a class="reference-link" href="../../Note%20Types/Code.md">Code</a>. |
| `datePattern`, `weekPattern`, `monthPattern`, `quarterPattern`, `yearPattern` | Customizes the title naming pattern of day / week / month / quarter / year notes. See <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Day Notes</a>. |
| `enableWeekNote`, `enableQuarterNote` | Enables optional week and quarter notes in the calendar hierarchy; set on the calendar root. See <a class="reference-link" href="../Advanced%20Showcases/Day%20Notes.md">Day Notes</a>. |
| `fullContentWidth` | Expands the note to the full editor width, ignoring the configured content width (useful for wide tables). See <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Content%20width.md">Content width</a>. |
| `iconPack` | Identifies a custom icon pack by its prefix. See <a class="reference-link" href="../../Theme%20development/Creating%20an%20icon%20pack.md">Creating an icon pack</a>. |
| `clipperInbox` | Overrides the default location where the Web Clipper saves clippings (defaults to the day note). See <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a>. |
| `similarNotesWidgetDisabled` | Disables the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Similar%20Notes.md">Similar Notes</a> ribbon tab (old layout only) |
| `docName` , `docUrl` | Used internally for the in-app help. |