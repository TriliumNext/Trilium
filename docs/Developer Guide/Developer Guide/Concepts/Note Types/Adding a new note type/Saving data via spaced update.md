# Saving data via spaced update
The data persistence is achieved via the spaced update mechanism which is already present and needs to be integrated within the newly created type widgets.

First, the class must implement `getData`, in order to retrieve the data from the custom widget in a serialized form. As an example from the mind map implementation:

```
async getData() {
    const mind = this.mind;
    if (!mind) {
        return;
    }

    return {
        content: mind.getDataString()
    };
}
```

Here the content is a string containing a JSON. It is also possible to provide attachments here as well, such as <a class="reference-link" href="SVG%20rendering.md">SVG rendering</a> to provide a preview of the content.

Then to trigger an update, register a listener within the custom widget that calls the spaced update, for example:

```
mind.bus.addListener("operation", (operation) => {
    this.spacedUpdate.scheduleUpdate();
});
```