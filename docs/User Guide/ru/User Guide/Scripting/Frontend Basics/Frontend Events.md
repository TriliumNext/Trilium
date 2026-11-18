# Frontend Events
Front-end scripts can be run automatically on certain triggering conditions.

To do so, set the `run` [label](../../Advanced%20Usage/Attributes/Labels.md) to either:

*   `frontendStartup` - when Trilium frontend starts up (or is refreshed), but not on mobile.
*   `mobileStartup` - when Trilium frontend starts up (or is refreshed), on mobile.

> [!NOTE]
> One script can be triggered on multiple events, this can be done by adding multiple `run` labels. Separating multiple values by commas **is not** supported.

Backend scripts have more powerful triggering conditions, for example they can run automatically on a hourly or daily basis, but also on events such as when a note is created or an attribute is modified. See the server-side <a class="reference-link" href="../Backend%20scripts/Backend%20Events.md">Events</a> for more information.

## Safe mode

While [safe mode](../../Advanced%20Usage/Safe%20mode.md) is active, scripts with events won't trigger.