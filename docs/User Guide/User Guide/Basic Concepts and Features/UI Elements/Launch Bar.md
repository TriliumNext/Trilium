# Launch Bar
## Position of the Launch bar

On desktop, depending on the layout selected, the launcher bar will either be on the left side of the screen with buttons displayed vertically or at the top of the screen. See <a class="reference-link" href="Vertical%20and%20horizontal%20layout.md">Vertical and horizontal layout</a> for more information.

On mobile, the launch bar will always be at the bottom.

If there are too many items in the launch bar to fit the screen, it will become scrollable.

## Terminology

*   **Launcher**: a button that can be (or is) displayed on the launch bar.
*   **Available Launcher**: a launcher that is not displayed on the launch bar, but can be added.
*   **Visible Launcher**: a launcher that is currently displayed on the launch bar.

## Configuring the desktop Launch bar

There are two ways to configure the launch bar:

*   Right click in the empty space between launchers on the launch bar and select _Configure launch bar…_
*   Click on the <a class="reference-link" href="Global%20menu.md">Global menu</a> and select _Configure launch bar_.

This will open a new tab with the <a class="reference-link" href="Note%20Tree.md">Note Tree</a> listing the launchers.

![](Launch%20Bar_image.jpg)

Expanding _Available Launchers_ section will show the list of launchers that are not displayed on the launch bar. The _Visible Launchers_ will show the ones that are currently displayed.

## Configuring the mobile launch bar

The launch bar on mobile uses a different configuration from the desktop one. The reasoning is that not all desktop icons are available on mobile, and fewer icons fit on a mobile screen.

To configure the launch bar on mobile, go to <a class="reference-link" href="Global%20menu.md">Global menu</a> and select _Configure launch bar_.

The configure the mobile launch bar while on the desktop (especially useful to configure more complicated launchers such as scripts or custom widgets), go to <a class="reference-link" href="Global%20menu.md">Global menu</a> → Advanced → Hidden notes and look for the _Mobile Launch Bar_ section. While in the hidden subtree, it's also possible to drag launchers between the _Mobile Launch Bar_ and (Desktop) _Launch Bar_ sections.

### Adding/removing and reordering launchers

To display a new launcher in the launch bar, first look for it in the _Available Launchers_ section. Then right click it and select _Move to visible launchers_. It is also possible to drag and drop the item manually.

Similarly, to remove it from the launch bar, simply look for it in _Visible Launchers_ then right click it and select _Move to available launchers_ or use drag-and-drop.

Drag-and-drop the items in the tree in order to change their order. See <a class="reference-link" href="Note%20Tree.md">Note Tree</a> for more interaction options, including using keyboard shortcuts.

### Adding a note by drag and drop

To add a note to the launch bar, drag it from the <a class="reference-link" href="Note%20Tree.md">Note Tree</a> onto the launch bar. A line between the launchers shows where the note will be placed. If the launch bar is scrollable, hold the note near either end to scroll it. Dropping the note adds a button with the note's title and icon, which opens the note when clicked.

*   Several notes selected in the tree can be dropped at once; they keep their order.
*   A note that is already on the launch bar, or a launcher dragged from the _Available Launchers_ section, is moved to the new place instead of being added again.

The button is a clone of the note in the _Visible Launchers_ section (see <a class="reference-link" href="../Notes/Cloning%20Notes.md">Cloning Notes</a>), so it always shows the note's current title and icon. Right click it and select _Remove from launch bar_ to remove the clone; the note itself stays where it is in the tree. If the launch bar is the only place the note is in, it's moved to the _Available Launchers_ instead, so that the note isn't deleted.

To list the note's children instead of opening the note, right click the button and check _Show as a folder_, the same way as for a [bookmark folder](../Navigation/Bookmarks.md). To open the note in a new tab, a split, a new window or a quick edit popup instead of the current tab, right click the button and pick a place under _Open mode_, as described in [Bookmarks](../Navigation/Bookmarks.md).

## Customizing the launcher

*   The icon of a launcher can be changed just like a normal note. See [note icons](../Notes/Note%20Icons%20%26%20Colors.md) for more information.
*   The title of the launcher can also be changed.

### Resetting

Resetting allows restoring the original configuration of Trilium for the launcher bar, or for a portion of it. Simply right click a launcher (or even the entire _Launch Bar_ section) and select _Reset_ to bring it back to the original state.

### Creating new launchers / types of launchers

Right click either the _Available launchers_ or _Visible launchers_ sections and select one of the options:

1.  **Note Launcher**  
    A note launcher will simply navigate to a specified note.
    
    1.  Set the `target` promoted attribute to the note to navigate to.
    2.  Optionally, set `hoistedNote` to hoist a particular note. See <a class="reference-link" href="../Navigation/Note%20Hoisting.md">Note Hoisting</a> for more information.
    3.  Optionally, set a `keyboardShortcut` to trigger the launcher.
2.  **Script Launcher**  
    An advanced launcher which will run a script upon pressing. See <a class="reference-link" href="../../Scripting.md">Scripting</a> for more information.
    
    1.  Set `script` to point to the desired script to run.
    2.  Optionally, set a `keyboardShortcut` to trigger the launcher.
3.  **Custom Widget**
    
    Allows defining a custom widget to be rendered inside the launcher. See <a class="reference-link" href="../../Scripting/Frontend%20Basics/Custom%20Widgets/Widget%20Basics.md">Widget Basics</a> for more information.
4.  **Spacers**  
    Launchers that create some distance between other launchers for better visual distinction.

Launchers are configured via predefined <a class="reference-link" href="../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>.