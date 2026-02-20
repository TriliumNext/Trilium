# Frontend Basics
Front-end scripts are custom JavaScript notes that are run on the client (browser environment)

There are four flavors of front-end scripts:

|     |     |
| --- | --- |
| Regular scripts | These are run with the current app and note context. These can be run either manually or automatically on start-up. |
| <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a> | These can introduce new UI elements in various positions, such as near the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, content area or even the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>. |
| <a class="reference-link" href="Frontend%20Basics/Launch%20Bar%20Widgets.md">Launch Bar Widgets</a> | Similar to <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a>, but dedicated to the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>. These can simply introduce new buttons or graphical elements to the bar. |
| <a class="reference-link" href="../Note%20Types/Render%20Note.md">Render Note</a> | This allows rendering custom content inside a note, using either HTML or Preact JSX. |

For more advanced behaviors that do not require a user interface (e.g. batch modifying notes), see <a class="reference-link" href="Backend%20scripts.md">Backend scripts</a>.

## Scripts

Scripts don't have any special requirements. They can be run manually using the _Execute_ button on the code note or they can be run automatically; to do so, set the `run` [label](../Advanced%20Usage/Attributes/Labels.md) to either:

*   `frontendStartup` - when Trilium frontend starts up (or is refreshed), but not on mobile.
*   `mobileStartup` - when Trilium frontend starts up (or is refreshed), on mobile.

> [!NOTE]
> Backend scripts have more powerful triggering conditions, for example they can run automatically on a hourly or daily basis, but also on events such as when a note is created or an attribute is modified. See the server-side <a class="reference-link" href="Backend%20scripts/Events.md">Events</a> for more information.

## Widgets

Widgets require a certain format in order for Trilium to be able to integrate them into the UI.

*   For legacy widgets, the script note must export a `BasicWidget` or a derived one (see <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets/Note%20context%20aware%20widget.md">Note context aware widget</a> or <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets/Right%20pane%20widget.md">Right pane widget</a>).
*   For Preact widgets, a built-in helper called `defineWidget` needs to be used.

For more information, see <a class="reference-link" href="Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a>.

## Script API

The front-end API of Trilium is available to all scripts running in the front-end context as global variable `api`. For a reference of the API, see <a class="reference-link" href="Script%20API/Frontend%20API">Frontend API</a>.

### Tutorial

For more information on building widgets, take a look at [Widget Basics](Frontend%20Basics/Custom%20Widgets/Widget%20Basics.md).