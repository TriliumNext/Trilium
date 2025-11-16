# Launch Bar
## Position of the Launch bar

Depending on the layout selected, the launcher bar will either be on the left side of the screen with buttons displayed vertically or at the top of the screen. See [Vertical and horizontal layout](Vertical%20and%20horizontal%20layout.md) for more information.

## Terminology

*   **Launcher**: a button that can be (or is) displayed on the launch bar.
*   **Available Launcher**: a launcher that is not displayed on the launch bar, but can be added.
*   **Visible Launcher**: a launcher that is currently displayed on the launch bar.

## Configuring the Launch bar

There are two ways to configure the launch bar:

*   Right click in the empty space between launchers on the launch bar and select _Configure Launchbar._
*   Click on the [Global menu](Global%20menu.md) and select _Configure Launchbar_.

This will open a new tab with the [Note Tree](Note%20Tree.md) listing the launchers.

![](Launch%20Bar_image.png)

Expanding _Available Launchers_ section will show the list of launchers that are not displayed on the launch bar. The _Visible Launchers_ will show the ones that are currently displayed.

### Adding/removing and reordering launchers

To display a new launcher in the launch bar, first look for it in the _Available Launchers_ section. Then right click it and select _Move to visible launchers_. It is also possible to drag and drop the item manually.

Similarly, to remove it from the launch bar, simply look for it in _Visible Launchers_ then right click it and select _Move to available launchers_ or use drag-and-drop.

Drag-and-drop the items in the tree in order to change their order. See [Note Tree](Note%20Tree.md) for more interaction options, including using keyboard shortcuts.

## Customizing the launcher

*   The icon of a launcher can be changed just like a normal note. See [Note Icons](../Notes/Note%20Icons.md) for more information.
*   The title of the launcher can also be changed.

### Resetting

Resetting allows restoring the original configuration of Trilium for the launcher bar, or for a portion of it. Simply right click a launcher (or even the entire _Launch Bar_ section) and select _Reset_ to bring it back to the original state.

### Creating new launchers / types of launchers

Right click either the _Available launchers_ or _Visible launchers_ sections and select one of the options:

1.  **Note Launcher**  
    A note launcher will simply navigate to a specified note.
    
    1.  Set the `target` promoted attribute to the note to navigate to.
    2.  Optionally, set `hoistedNote` to hoist a particular note. See [Note Hoisting](../Navigation/Note%20Hoisting.md) for more information.
    3.  Optionally, set a `keyboardShortcut` to trigger the launcher.
2.  **Script Launcher**  
    An advanced launcher which will run a script upon pressing. See [Scripts](../../Scripting.md) for more information.
    
    1.  Set `script` to point to the desired script to run.
    2.  Optionally, set a `keyboardShortcut` to trigger the launcher.
3.  **Custom Widget**
    
    Allows defining a custom widget to be rendered inside the launcher. See [Widget Basics](../../Scripting/Frontend%20Basics/Custom%20Widgets/Widget%20Basics.md) for more information.
4.  **Spacers**  
    Launchers that create some distance between other launchers for better visual distinction.

Launchers are configured via predefined [Promoted Attributes](../../Advanced%20Usage/Attributes/Promoted%20Attributes.md).