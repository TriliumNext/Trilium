# New Layout
The _New layout_ is a series of UI/UX changes that were introduced in v0.101.0 that heavily change both existing UI elements, as well as adding some new ones. The goal of this new layout is to modernize the application and to make it more intuitive but at the same time to reduce clutter.

## Newly introduced features

### Status bar

At the bottom of the window there is a new bar called the _Status bar_. This bar houses multiple items such as the Breadcrumb navigation and information and settings about the current note, such as the [content language](../../Note%20Types/Text/Content%20language%20%26%20Right-to-le.md) and <a class="reference-link" href="../../Advanced%20Usage/Attributes.md">Attributes</a>.

For more information, consult the [dedicated page](New%20Layout/Status%20bar.md).

<figure class="image"><img style="aspect-ratio:1150/27;" src="5_New Layout_image.png" width="1150" height="27"></figure>

### Inline title

In previous versions of Trilium, the title bar was fixed at all times. In the new layout, there is both a fixed title bar and one that scrolls with the text. The newly introduced title is called the _Inline title_ and it displays the title in a larger font, while also displaying additional information such as the creation and the modification date.

Whenever the title is scrolled past, the fixed title is shown instead.

This only affects <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> and <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> notes. Note types that take the entirety of the screen such as <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a> will always have only the fixed title bar.

Depending on the note type, the inline title will also present some more interactive options such as being able to switch the note type (see below).

<figure class="image"><img style="aspect-ratio:899/122;" src="New Layout_image.png" width="899" height="122"><figcaption>The <em>Inline title</em>, which is displayed at the top of the note and can be scrolled past.</figcaption></figure><figure class="image"><img style="aspect-ratio:910/104;" src="4_New Layout_image.png" width="910" height="104"><figcaption>The fixed title bar. The title only appears after scrolling past the <em>Inline title</em>.</figcaption></figure>

### New note type switcher

When a new <a class="reference-link" href="../../Note%20Types/Text.md">Text</a> or <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note is created, a note type switcher will appear below the _Inline title_. Apart from changing the note type, it's also possible to apply a [template](../../Advanced%20Usage/Templates.md).

The switcher will disappear as soon as a text is entered.

<img src="6_New Layout_image.png" width="735" height="143">

### Note badges

Note badges appear near the fixed note title and indicate important information about the note such as whether it is read-only. Some of the badges are also interactive.

<figure class="image"><img style="aspect-ratio:910/49;" src="3_New Layout_image.png" width="910" height="49"></figure>

The following badges are available:

*   **Read-only badge**, which will be shown if the note is not editable due to either automatic read-only or manual read-only. Clicking on the badge will temporarily edit the note (similar to the Edit [floating button](Floating%20buttons.md)).
*   **Share badge**, which will indicate that the current note is shared. The badge will also indicate if the share is on the local network (for the desktop application without <a class="reference-link" href="../../Installation%20%26%20Setup/Synchronization.md">Synchronization</a> set up) or publicly accessible (for the server).
*   **Web clip badge**, which will indicate if the note was clipped using the <a class="reference-link" href="../../Installation%20%26%20Setup/Web%20Clipper.md">Web Clipper</a>. The badge acts as a link, so it can be clicked on to navigate to the page or right clicked for more options.
*   **Execute badge**, for [scripts](../../Scripting.md) or [saved SQL queries](../../Advanced%20Usage/Database/Manually%20altering%20the%20database/SQL%20Console.md) which have an execute button or a description.

Some of these badges replace the dedicated panels at the top of the note.

### Collapsible sections

<figure class="image"><img style="aspect-ratio:496/265;" src="1_New Layout_image.png" width="496" height="265"></figure>

The following sections have been made collapsible:

*   _Promoted Attributes_
    *   For full-height notes such as <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a>, the promoted attributes are collapsed by default to make room.
    *   The keyboard shortcut previously used to trigger the promoted attributes ribbon tab (which was no longer working) has been repurposed to toggle the promoted attributes instead.
*   _Edited Notes_, which appears for <a class="reference-link" href="../../Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a> is now shown underneath the title.
    *   Whether the section is collapsed or not depends on the choice in <a class="reference-link" href="Options.md">Options</a> → Appearance.
*   _Search Properties_, which appears for the full <a class="reference-link" href="../Navigation/Search.md">Search</a> and <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a>.

### Save status indicator

<img class="image-style-align-right" src="2_New Layout_image.png" width="168" height="47">To the right of the note title, a temporary indicators appears after making a change to the document that indicates whether the document has been saved.

It indicates the following states:

*   _Unsaved_, if the changes will be saved soon.
*   _Saving_, if the changes are being saved.
*   _Saved_, if all the changes were successfully saved to the server.
*   _Error_, if the changes could not be saved, for example due to a communication server with the server.

After all changes have been saved, the indicator will hide automatically after a few seconds.

## Changing to the existing layout

### Removal of the ribbon

The most significant change is the removal of the ribbon. All the actions and options from the ribbon were integrated in other places in the application.

Here's how all the different tabs that were once part of the ribbon are now available in the new layout:

*   “Formatting toolbar” was relocated to the top of the page.
    *   Instead of having one per split, now there is a single formatting toolbar per tab. This allows more space for the toolbar items.
*   “Owned attributes” and “Inherited attributes” were merged and moved to the status bar region (displayed one above the other).
*   “Basic Properties” were integrated in the <a class="reference-link" href="Note%20buttons.md">Note buttons</a> menu.
    *   The only exception here is the Language combo box which can now be found in the status bar (top-right of the screen).
*   “File” and “Image” tabs
    *   The buttons were moved to the right of the note title, as dedicated entries in <a class="reference-link" href="Note%20buttons.md">Note buttons</a>.
    *   The info section has been merged into the _Note info_ section of the status bar.
*   Edited notes
    *   Moved underneath the title, displayed under a collapsible area and the notes are represented as badges/chips.
    *   Whether the section is expanded or collapsed depends on the “Edited Notes ribbon tab will automatically open on day notes” setting from Options → Appearance.
*   Search definition tab
    *   Moved underneath the title under a collapsible area.
    *   Expanded by default for new searches, collapsed for saved searches.
*   The Note map is now available in the Note actions menu.
    *   Instead of opening into a panel in the ribbon, the note map now opens in a side split (similar to the in-app help).
*   “Note info” tab was moved to a small (i) icon in the status bar.
*   “Similar notes” tab
    *   Moved to the status bar, by going to the “Note info” section and pressing the button to show similar notes.
    *   Displayed as a fixed panel, similar to the attributes.
*   The Collection properties tab were relocated under the note title and grouped into:
    *   A combo box to quickly switch between views.
    *   Individual settings for the current view in a submenu.
*   Some smaller ribbon tabs were converted to badges that appear near the note title in the breadcrumb section:
    *   Original URL indicator for clipped web pages (`#pageUrl`).
    *   SQL and script execute buttons.

> [!NOTE]
> The ribbon keyboard shortcuts (e.g. `toggleRibbonTabClassicEditor`) have been repurposed to work on the new layout, where they will toggle the appropriate panel.

### Removal of the floating buttons

Most of the buttons were relocated to the right of the note title, in the <a class="reference-link" href="Note%20buttons.md">Note buttons</a> area, with the exception of:

*   The Edit button is displayed near the note title, as a badge.
*   _Backlinks_ is displayed in the status bar. When clicked, the same list of backlinks is displayed.
*   Relation map zoom buttons are now part of the relation map itself.
*   Export image to PNG/SVG are now in the Note actions menu, in the _Export as image_ option.

### Changes to the sidebar

The sidebar (also known as the right pane) also received some important changes.

The previous iteration of the sidebar would appear contextually, depending on whether there are any items to be displayed. This caused occasional content shifts when moving between two panes in a split view. In the new layout, the sidebar acts more like the <a class="reference-link" href="Note%20Tree.md">Note Tree</a> pane, remaining visible even if there is nothing to display.

In order to toggle the sidebar, there is a new button on the top-right side of the screen, near the window buttons (on Windows and Linux).

Now each section of the sidebar (e.g. “Table of Contents”, “Highlights list”) is individually collapsible and will remember whether it was collapsed.

Some sidebar items also have a contextual menu, indicated by the three dots on the title. For example, the highlights filter can be adjusted directly from that menu. 

Custom widgets are still supported. For custom scripts, the three dots menu allows quick navigation to the corresponding script note.

## How to toggle the new layout

Starting with v0.101.0, this new layout is enabled by default. It is possible to fall back to the old layout by going to <a class="reference-link" href="Options.md">Options</a> → Appearance and selecting _Old layout_.

> [!IMPORTANT]
> Since a new layout was introduced, this becomes the standard one. The _Old layout_ is considered deprecated and will not receive new features (for example, the breadcrumb) as we focus on the new one. At some point the old layout will be removed entirely, as maintaining two layouts with major differences creates a maintenance burden.