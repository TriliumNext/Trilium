# Read-only database
> [!WARNING]
> This functionality is still in preview, expect possible issues or even the feature disappearing completely.  
> Feel free to [report](../Troubleshooting/Reporting%20issues.md) any issues you might have.

The read-only database is an alternative to <a class="reference-link" href="Sharing.md">Sharing</a> notes. Although the share functionality works pretty well to publish pages to the Internet in a wiki, blog-like format it does not offer the full functionality behind Trilium (such as the advanced <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> or the interactivity behind <a class="reference-link" href="../Collections.md">Collections</a> or the various <a class="reference-link" href="../Note%20Types.md">Note Types</a>).

When the database is in read-only mode, the Trilium application can be used as normal, but editing is disabled and changes are made in-memory only.

## What it does

*   All notes are read-only, without the possibility of editing them.
*   Features that would normally alter the database such as the list of recent notes are disabled.

## Limitations

*   Some features might “slip through” and still end up creating a note, for example.
    *   However, the database is still read-only, so all modifications will be reset if the server is restarted.
    *   Whenever this occurs, `ERROR: read-only DB ignored` will be shown in the logs.

## Setting a database as read-only

First, make sure the database is initialized (e.g. the first set up is complete). Then modify the [config.ini](Configuration%20\(config.ini%20or%20e.md) by looking for the `[General]` section and adding a new `readOnly` field:

```
[General]
readOnly=true
```

If your server is already running, restart it to apply the changes.

Similarly, to disable read-only remove the line or set it to `false`.