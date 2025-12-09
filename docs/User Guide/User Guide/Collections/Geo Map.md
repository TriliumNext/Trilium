# Geo Map
> [!IMPORTANT]
> <a class="reference-link" href="../Advanced%20Usage/Attributes.md">Attributes</a><a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a><a class="reference-link" href="../Advanced%20Usage/Attributes.md">Attributes</a>Starting with Trilium v0.97.0, the geo map has been converted from a standalone [note type](../Note%20Types.md) to a type of view for the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Notes/Note%20List.md">Note List</a>. 

<figure class="image image-style-align-center"><img style="aspect-ratio:892/675;" src="9_Geo Map_image.png" width="892" height="675"></figure>

This note type displays the children notes on a geographical map, based on an attribute. It is also possible to add new notes at a specific location using the built-in interface.

## Creating a new geo map

|     |     |     |
| --- | --- | --- |
| 1   | <figure class="image"><img style="aspect-ratio:483/413;" src="15_Geo Map_image.png" width="483" height="413"></figure> | Right click on any note on the note tree and select _Insert child note_ → _Geo Map (beta)_. |
| 2   | <figure class="image image-style-align-center image_resized" style="width:53.44%;"><img style="aspect-ratio:1720/1396;" src="8_Geo Map_image.png" width="1720" height="1396"></figure> | By default the map will be empty and will show the entire world. |

## Repositioning the map

*   Click and drag the map in order to move across the map.
*   Use the mouse wheel, two-finger gesture on a touchpad or the +/- buttons on the top-left to adjust the zoom.

The position on the map and the zoom are saved inside the map note and restored when visiting again the note.

## Adding a marker using the map

### Adding a new note using the plus button

|     |     |     |
| --- | --- | --- |
| 1   | To create a marker, first navigate to the desired point on the map. Then press the ![](10_Geo%20Map_image.png) button in the [Floating buttons](../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md) (top-right) area.      <br>  <br>If the button is not visible, make sure the button section is visible by pressing the chevron button (![](17_Geo%20Map_image.png)) in the top-right of the map. |     |
| 2   | <img class="image_resized" style="aspect-ratio:1730/416;width:100%;" src="2_Geo Map_image.png" width="1730" height="416"> | Once pressed, the map will enter in the insert mode, as illustrated by the notification.         <br>  <br>Simply click the point on the map where to place the marker, or the Escape key to cancel. |
| 3   | <img class="image_resized" style="aspect-ratio:1586/404;width:100%;" src="7_Geo Map_image.png" width="1586" height="404"> | Enter the name of the marker/note to be created. |
| 4   | <img class="image_resized" style="aspect-ratio:1696/608;width:100%;" src="16_Geo Map_image.png" width="1696" height="608"> | Once confirmed, the marker will show up on the map and it will also be displayed as a child note of the map. |

### Adding a new note using the contextual menu

1.  Right click anywhere on the map, where to place the newly created marker (and corresponding note).
2.  Select _Add a marker at this location_.
3.  Enter the name of the ne<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>wly created note.
4.  The map should be updated with the new marker.

### Adding an existing note on note from the note tree

1.  Select the desired note in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>.
2.  Hold the mouse on the note and drag it to the map to the desired location.
3.  The map should be updated with the new marker.

This works for:

*   Notes that are not part of the geo map, case in which a [clone](../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) will be created.
*   Notes that are a child of the geo map but not yet positioned on the map.
*   Notes that are a child of the geo map and also positioned, case in which the marker will be relocated to the new position.

> [!NOTE]
> Dragging existing notes only works if the map is in editing mode. See the _Read-only_ section for more information.

## How the location of the markers is stored

The location of a marker is stored in the `#geolocation` attribute of the child notes:

<img src="18_Geo Map_image.png" width="1288" height="278">

This value can be added manually if needed. The value of the attribute is made up of the latitude and longitude separated by a comma.

## Repositioning markers

It's possible to reposition existing markers by simply drag and dropping them to the new destination.

As soon as the mouse is released, the new position is saved.

If moved by mistake, there is currently no way to undo the change. If the mouse was not yet released, it's possible to force a refresh of the page (<kbd>Ctrl</kbd>+<kbd>R</kbd> ) to cancel it.

## Interaction with the markers

*   Hovering over a marker will display a <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tooltip.md">Note Tooltip</a> with the content of the note it belongs to.
    *   Clicking on the note title in the tooltip will navigate to the note in the current view.
*   Middle-clicking the marker will open the note in a new tab.
*   Right-clicking the marker will open a contextual menu (as described below).
*   If the map is in read-only mode, clicking on a marker will open a <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a> popup for the corresponding note.

## Contextual menu

It's possible to press the right mouse button to display a contextual menu.

1.  If right-clicking an empty section of the map (not on a marker), it allows to:
    1.  Displays the latitude and longitude. Clicking this option will copy them to the clipboard.
    2.  Open the location using an external application (if the operating system supports it).
    3.  Adding a new marker at that location.
2.  If right-clicking on a marker, it allows to:
    1.  Displays the latitude and longitude. Clicking this option will copy them to the clipboard.
    2.  Open the location using an external application (if the operating system supports it).
    3.  Open the note in a new tab, split or window.
    4.  Remove the marker from the map, which will remove the `#geolocation` attribute of the note. To add it back again, the coordinates have to be manually added back in.

## Icon and color of the markers

<figure class="image image-style-align-center"><img style="aspect-ratio:523/295;" src="Geo Map_image.jpg" alt="image" width="523" height="295"></figure>

The markers will have the same icon as the note.

It's possible to add a custom color to a marker by assigning them a `#color` attribute such as `#color=green`.

## Adding the coordinates manually

In a nutshell, create a child note and set the `#geolocation` attribute to the coordinates.

The value of the attribute is made up of the latitude and longitude separated by a comma.

### Adding from Google Maps

|     |     |     |
| --- | --- | --- |
| 1   | <figure class="image image-style-align-center image_resized" style="width:56.84%;"><img style="aspect-ratio:732/918;" src="12_Geo Map_image.png" width="732" height="918"></figure> | Go to Google Maps on the web and look for a desired location, right click on it and a context menu will show up.         <br>  <br>Simply click on the first item displaying the coordinates and they will be copied to clipboard.         <br>  <br>Then paste the value inside the text box into the `#geolocation` attribute of a child note of the map (don't forget to surround the value with a `"` character). |
| 2   | <figure class="image image-style-align-center image_resized" style="width:100%;"><img style="aspect-ratio:518/84;" src="4_Geo Map_image.png" width="518" height="84"></figure> | In Trilium, create a child note under the map. |
| 3   | <figure class="image image-style-align-center image_resized" style="width:100%;"><img style="aspect-ratio:1074/276;" src="11_Geo Map_image.png" width="1074" height="276"></figure> | And then go to Owned Attributes and type `#geolocation="`, then paste from the clipboard as-is and then add the ending `"` character. Press Enter to confirm and the map should now be updated to contain the new note. |

### Adding from OpenStreetMap

Similarly to the Google Maps approach:

|     |     |     |
| --- | --- | --- |
| 1   | <img class="image_resized" style="aspect-ratio:562/454;width:100%;" src="1_Geo Map_image.png" width="562" height="454"> | Go to any location on openstreetmap.org and right click to bring up the context menu. Select the “Show address” item. |
| 2   | <img class="image_resized" style="aspect-ratio:696/480;width:100%;" src="Geo Map_image.png" width="696" height="480"> | The address will be visible in the top-left of the screen, in the place of the search bar.         <br>  <br>Select the coordinates and copy them into the clipboard. |
| 3   | <img class="image_resized" style="aspect-ratio:640/276;width:100%;" src="5_Geo Map_image.png" width="640" height="276"> | Simply paste the value inside the text box into the `#geolocation` attribute of a child note of the map and then it should be displayed on the map. |

## Adding GPS tracks (.gpx)

Trilium has basic support for displaying GPS tracks on the geo map.

|     |     |     |
| --- | --- | --- |
| 1   | <figure class="image image-style-align-center"><img style="aspect-ratio:226/74;" src="3_Geo Map_image.png" width="226" height="74"></figure> | To add a track, simply drag & drop a .gpx file inside the geo map in the note tree. |
| 2   | <figure class="image image-style-align-center"><img style="aspect-ratio:322/222;" src="14_Geo Map_image.png" width="322" height="222"></figure> | In order for the file to be recognized as a GPS track, it needs to show up as `application/gpx+xml` in the _File type_ field. |
| 3   | <figure class="image image-style-align-center"><img style="aspect-ratio:620/530;" src="6_Geo Map_image.png" width="620" height="530"></figure> | When going back to the map, the track should now be visible.         <br>  <br>The start and end points of the track are indicated by the two blue markers. |

> [!NOTE]
> The starting point of the track will be displayed as a marker, with the name of the note underneath. The start marker will also respect the icon and the `color` of the note. The end marker is displayed with a distinct icon.
> 
> If the GPX contains waypoints, they will also be displayed. If they have a name, it is displayed when hovering over it with the mouse.

## Read-only mode

When a map is in read-only all editing features will be disabled such as:

*   The add button in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a>.
*   Dragging markers.
*   Editing from the contextual menu (removing locations or adding new items).

To enable read-only mode simply press the _Lock_ icon from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Floating%20buttons.md">Floating buttons</a>. To disable it, press the button again.

## Configuration

### Map Style

The styling of the map can be adjusted in the _Collection Properties_ tab in the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a> or manually via the `#map:style` attribute.

The geo map comes with two different types of styles:

*   Raster styles
    *   For these styles the map is represented as a grid of images at different zoom levels. This is the traditional way OpenStreetMap used to work.
    *   Zoom is slightly restricted.
    *   Currently, the only raster theme is the original OpenStreetMap style.
*   Vector styles
    *   Vector styles are not represented as images, but as geometrical shapes. This makes the rendering much smoother, especially when zooming and looking at the building edges, for example.
    *   The map can be zoomed in much further.
    *   These come both in a light and a dark version.
    *   The vector styles come from [VersaTiles](https://versatiles.org/), a free and open-source project providing map tiles based on OpenStreetMap.

> [!NOTE]
> Currently it is not possible to use a custom map style.

### Scale

Activating this option via the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Ribbon.md">Ribbon</a> or manually via `#map:scale` will display an indicator in the bottom-left of the scale of the map.

## Troubleshooting

<figure class="image image-style-align-right image_resized" style="width:34.06%;"><img style="aspect-ratio:678/499;" src="13_Geo Map_image.png" width="678" height="499"></figure>

### Grid-like artifacts on the map

This occurs if the application is not at 100% zoom which causes the pixels of the map to not render correctly due to fractional scaling. The only possible solution is to set the UI zoom at 100% (default keyboard shortcut is <kbd>Ctrl</kbd>+<kbd>0</kbd>).