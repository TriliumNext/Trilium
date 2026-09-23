# Drawing shapes
The following shapes can be drawn on the map: a path, an area, a rectangle or a circle.

Unlike markers, the title of the shape is not displayed directly on the map but it will be displayed when hovered.

The shape will also be drawn in the [color of the note](../../Basic%20Concepts%20and%20Features/Notes/Note%20Icons%20%26%20Colors.md), if set. 

## Drawing a shape on the map

To draw a shape, use the toolbar that appears in the top-center area on desktop and on the left-center on mobile and in split view.

Once a shape is drawn, it cannot be moved or modified. To do so, simply remove the shape and draw another one instead.

### Drawing a path or an area

1.  Press the _Draw a path on the map_ or _Draw an area on the map_ button. The button stays held down while the tool is armed, and a notification describes what to do.
2.  Click on the map once for each point. The shape is previewed as it grows.
3.  Finish it by pressing <kbd>Enter</kbd>. A path can also be finished by clicking its last point again, and an area by clicking the corner it started from. A path needs at least two points and an area at least three.

### Drawing a rectangle or a circle

1.  Press the _Draw a rectangle on the map_ or _Draw a circle on the map_ button.
2.  Click once to set the first corner, or the center of the circle. Click a second time at the opposite corner, or at the distance the circle should reach.
3.  Instead of two clicks you can drag from one to the other. This also works on mobile and other touch-based apps.

### Finishing and cancelling

To give up on a shape while drawing it, press <kbd>Escape</kbd> or press the tool's button again. Whatever has been drawn so far is discarded.

The tool is deactivated once a shape is finished, so drawing a second shape requires another button press.

## Interaction

Once a shape is created:

*   Clicking a shape opens the standard panel which allows changing the title, the content and with buttons to open the note or remove it.
    *   When clicking, a marker takes priority over the shape.
*   Right-clicking a shape opens a contextual menu similar to the one for markers, which allows opening the corresponding note or removing the shape.
*   Typing in the map's search bar finds shapes by their title, as it does markers. Selecting one brings the whole shape into view.

## How shapes are represented

Shapes are represented quite similarly to markers, which means each shape is a note. The information about the same is stored using a [label](../../Advanced%20Usage/Attributes/Labels.md) called `geoShape`.