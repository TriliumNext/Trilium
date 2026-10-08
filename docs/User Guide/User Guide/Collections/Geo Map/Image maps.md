# Image maps
An image map is a geo map drawn over an image of your own instead of a world map, such as a floor plan, a fantasy map for a tabletop game, or a diagram to annotate. Markers and shapes work as they do on a geo map, but their positions are measured on the image instead of in latitude and longitude: in the image's own pixels, or in a coordinate system of your choosing, such as the one a video game uses.

## Creating an image map

1.  Upload the image as a note of its own, for example by dragging the file into the note tree. PNG, JPEG, WebP and GIF images are supported; SVG images are not.
2.  Create a geo map, or open an existing one.
3.  In the attributes of the geo map, add a `~map:image` [relation](../../Advanced%20Usage/Attributes/Relations.md) pointing to the image note.

The map then shows the image instead of the world map and opens with the whole image in view. To go back to a world map, remove the relation.

> [!NOTE]
> The image is drawn as a single picture, so very large images can fail to display on devices whose graphics card cannot hold them. Images up to 4096 pixels on their longer side are safe on practically every device.

## Interaction

Adding, moving and removing markers, drawing shapes, the popup view and the contextual menu work as described for the <a class="reference-link" href="../Geo%20Map.md">Geo Map</a>. The camera stays over the image and can zoom in up to four times past the image's own resolution.

The features that only make sense on a real map are not available on an image map:

*   Searching the map and searching for places online.
*   Going to your location.
*   Adding GPS tracks.
*   Clicking the places the base map shows.
*   The 3D buildings and the scale.
*   Opening a location in an external map application.

The look of the marker titles follows the image: if the image is dark, add the `#map:darkStyle` label to the geo map so that the titles are drawn in a light color.

## Choosing the coordinate system

By default, positions are measured in pixels of the image at its original size, from its top-left corner, with `x` growing to the right and `y` growing downwards.

To use coordinates of your own instead, add a `#map:imageBounds` label to the geo map, naming the coordinates of the image's top-left corner and of its bottom-right corner as `x,y x,y`, with a space between the two corners. All positions are then read and written in those coordinates, including the ones shown in the contextual menu and in the popup view. For example:

*   A screenshot of a game map that covers `x` from -512 to 512 and `y` from -512 to 512, with `y` growing downwards: `#map:imageBounds=-512,-512 512,512`. Coordinates copied from the game can then be pasted directly into `#imagePosition`.
*   A world whose `y` grows upwards, with the origin in the middle of the image: `#map:imageBounds=-2000,1000 2000,-1000`. A top-left `y` larger than the bottom-right one is what flips the axis.
*   A floor plan measured in meters: `#map:imageBounds=0,0 24,12`.

The two axes don't have to use the same scale. A circle is always measured in the map's own units, so it appears as an ellipse when the units are stretched differently along the two axes.

A value that cannot be read, or whose corners share an `x` or a `y`, is ignored and the pixels of the image are used instead.

## How the positions are stored

Because positions are stored in different labels from the ones of a geo map, the same note can be placed both on a geo map and on an image map.

| Label | Content |
| --- | --- |
| `#imagePosition` | The position of a marker, as `x,y`, for example `#imagePosition=320,145`. |
| `#imageShape` | A shape, in the same format as `#geoShape` (see <a class="reference-link" href="Drawing%20shapes.md">Drawing shapes</a>) but with `x,y` pairs, and a circle's radius in the map's units, for example `#imageShape=circle:400,300 50`. |

The positions belong to the coordinate system, not to the image. When replacing the image with a different one, for example a higher-resolution copy, keep `#map:imageBounds` describing the area the new image covers and every marker stays in place. Without `#map:imageBounds`, the positions are pixels, so an image of a different size moves the markers relative to what the image shows; to avoid that, set `#map:imageBounds` to the size of the old image (`0,0 <width>,<height>`) before replacing it.

> [!TIP]
> To draw freely over an image instead of placing notes on it, consider a <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a>.