# Image maps
An image map is a geo map drawn over an image of your own instead of a world map, such as a floor plan, a fantasy map for a tabletop game, or a diagram to annotate. Markers and shapes work as they do on a geo map, but their positions are measured in the image's own pixels instead of latitude and longitude.

## Creating an image map

1.  Upload the image as a note of its own, for example by dragging the file into the note tree.
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

## How the positions are stored

Positions are stored in pixels of the image at its original size, measured from its top-left corner, with `x` growing to the right and `y` growing downwards. Because they are stored in different labels from the ones of a geo map, the same note can be placed both on a geo map and on an image map.

| Label | Content |
| --- | --- |
| `#imagePosition` | The position of a marker, as `x,y`, for example `#imagePosition=320,145`. |
| `#imageShape` | A shape, in the same format as `#geoShape` (see <a class="reference-link" href="Drawing%20shapes.md">Drawing shapes</a>) but with `x,y` pairs, and a circle's radius in pixels, for example `#imageShape=circle:400,300 50`. |

Since the positions are in pixels, replacing the image with one of a different size moves the markers relative to what the image shows. Prefer keeping the same dimensions when updating the image.

> [!TIP]
> To draw freely over an image instead of placing notes on it, consider a <a class="reference-link" href="../../Note%20Types/Canvas.md">Canvas</a>.