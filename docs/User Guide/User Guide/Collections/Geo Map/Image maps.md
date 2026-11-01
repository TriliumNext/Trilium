# Image maps
An image map is a geo map drawn over an image of your own instead of a world map, such as a floor plan, a fantasy map for a tabletop game, or a diagram to annotate. Markers and shapes work as they do on a geo map, but their positions are measured on the image instead of in latitude and longitude: in the image's own pixels, or in a coordinate system of your choosing, such as the one a video game uses.

## Creating an image map

1.  Upload the image as a note of its own, for example by dragging the file into the note tree. PNG, JPEG, WebP and GIF images are supported; SVG images are not.
2.  Create a geo map, or open an existing one.
3.  Open the <span class="tn-icon bx bx-cog"></span>_Geo map properties_ dialog from the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> or from the settings menu of the <a class="reference-link" href="../Collection%20Properties.md">Collection Properties</a>.
4.  Under _Background_, set _Type_ to _Custom image_, then choose the image note in _Image note_. The list only offers image notes in a format the map can draw (PNG, JPEG, WebP or GIF), and shows all of them before anything is typed.

The map then shows the image instead of the world map and opens with the whole image in view. To go back to a world map, set _Type_ back to _Vector & Raster_. The image is switched off rather than removed: its relation is renamed to `~disabled:map:image`, so setting _Type_ to _Custom image_ again brings back the same image, with its coordinates. An image that the geo map inherits from a parent note or a template can only be switched off on the note that holds it.

The image note is stored in a `~map:image` [relation](../../Advanced%20Usage/Attributes/Relations.md) of the geo map, which can also be added by hand.

## Image size

Images are resized when they are uploaded, so by default the image of a map is at most 2000 pixels on its longer side, which can be too coarse for a detailed map. To keep an image at a higher resolution, do one of the following before uploading it:

*   In <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Media_, raise _Max image dimensions_ or turn off _Automatically compress images_.
*   Upload it through the _Import_ dialog with _Compress images_ unchecked.

An image that was already uploaded keeps its size; upload it again after changing the settings.

The image is drawn as a single picture by the graphics card, which limits how large it can be. Images up to 4096 pixels on their longer side are safe on practically every device, and most computers handle up to 16384 pixels. On a device whose graphics card cannot hold the image, the markers and shapes still appear but the image itself does not. The _Geo map properties_ dialog warns about an image larger than 4096 pixels, and about one that can't be used at all, such as an SVG image.

## Interaction

Adding, moving and removing markers, drawing shapes, the popup view and the contextual menu work as described for the <a class="reference-link" href="../Geo%20Map.md">Geo Map</a>. The camera stays over the image and can zoom in up to four times past the image's own resolution.

The features that only make sense on a real map are not available on an image map:

*   Searching the map and searching for places online.
*   Going to your location.
*   Adding GPS tracks.
*   Clicking the places the base map shows.
*   The 3D buildings.
*   Opening a location in an external map application.

The look of the marker titles follows the image: if the image is dark, turn on _Dark image_ under _Background_ in the _Geo map properties_ dialog, so that the titles are drawn in a light color. This sets the `#map:darkStyle` label.

The _Map style_ setting doesn't apply to an image map, so it's hidden from the settings menu of the collection while the map has an image.

## Choosing the coordinate system

By default, positions are measured in pixels of the image at its original size, from its top-left corner, with `x` growing to the right and `y` growing downwards.

To use coordinates of your own instead, open the _Geo map properties_ dialog, set _Coordinates_ under _Background_ to _Custom_, and enter the coordinates of the image's _Top-left corner_ and _Bottom-right corner_. Switching to _Custom_ starts from the image's size in pixels, so the markers stay where they are until the corners are changed; for that reason, _Custom_ can only be chosen once the image has loaded. All positions are then read and written in those coordinates, including the ones shown in the contextual menu and in the popup view. To go back to pixels, set _Coordinates_ to _Image pixels_. Corners that the geo map inherits from a parent note or a template can only be removed on the note that holds them; entering other corners on this map overrides them.

The corners are stored in the `#map:imageBounds` label of the geo map as `x,y x,y`, with a space between the two corners, which can also be set by hand. For example:

*   A screenshot of a game map that covers `x` from -512 to 512 and `y` from -512 to 512, with `y` growing downwards: `#map:imageBounds=-512,-512 512,512`. Coordinates copied from the game can then be pasted directly into `#mapPosition`.
*   A world whose `y` grows upwards, with the origin in the middle of the image: `#map:imageBounds=-2000,1000 2000,-1000`. A top-left `y` larger than the bottom-right one is what flips the axis.
*   A floor plan measured in meters: `#map:imageBounds=0,0 24,12`.

The two axes don't have to use the same scale. A circle is always measured in the map's own units, so it appears as an ellipse when the units are stretched differently along the two axes.

Corners that share an `x` or a `y` don't span an area: the dialog doesn't save them, and a label holding them, or a value that cannot be read, is ignored and the pixels of the image are used instead.

## Coordinate rulers

Enabling _Show scale_ in the collection properties draws rulers along the edges of the image instead of a distance scale. Round values of the map's coordinates are marked with ticks along all four edges, labeled along the top and left ones, with faint grid lines across the image. The spacing follows the zoom level, and the values follow `#map:imageBounds` when it is set.

The rulers are drawn on the image itself, so they move out of view along with its edges when zooming in. The grid lines remain visible across the image.

## How the positions are stored

Because positions are stored in different labels from the ones of a geo map, the same note can be placed both on a geo map and on an image map.

| Label | Content |
| --- | --- |
| `#mapPosition` | The position of a marker, as `x,y`, for example `#mapPosition=320,145`. |
| `#mapShape` | A shape, in the same format as `#geoShape` (see <a class="reference-link" href="Drawing%20shapes.md">Drawing shapes</a>) but with `x,y` pairs, and a circle's radius in the map's units, for example `#mapShape=circle:400,300 50`. |

The positions belong to the coordinate system, not to the image. When replacing the image with a different one, for example a higher-resolution copy, keep `#map:imageBounds` describing the area the new image covers and every marker stays in place. With _Image pixels_, the positions are pixels, so an image of a different size moves the markers relative to what the image shows; to avoid that, switch _Coordinates_ to _Custom_ before replacing the image, which keeps the size of the old one (`0,0 <width>,<height>`) as the corners.

> [!TIP]
> To draw freely over an image instead of placing notes on it, consider a <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a>.