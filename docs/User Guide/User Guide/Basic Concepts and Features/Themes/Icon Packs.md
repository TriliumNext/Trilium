# Icon Packs
## Importing an existing icon pack

Icon packs are specific to Trilium, so they must either be created from scratch (see below) or imported from a ZIP file from a third-party developer.

> [!NOTE]
> **Icon packs are third-party content**  
>   
> The Trilium maintainers are not responsible for keeping these icon packs up to date. If you have an issue with a specific icon pack, then the issue must be reported to the third-party developer responsible for it, not the Trilium team.

To import an icon pack:

1.  Ideally, create a dedicated spot in your note tree where to place the icon packs.
2.  Right click the note where to put it and select _Import into note_.
3.  Uncheck _Safe import_.
4.  Select _Import_.
5.  [Refresh the application](../../Troubleshooting/Refreshing%20the%20application.md).

> [!WARNING]
> Since _Safe import_ is disabled, make sure you trust the source as it could contain dangerous third-party scripts. One good way to check if the icon pack is safe is to manually extract the .zip and inspect the file contents. Icon packs should only contain a font file and a JSON file. Other files (especially scripts) are to be considered harmful.

## Creating an icon pack

Creating an icon pack requires some scripting knowledge outside Trilium in order to generate the list of icons. For information, see <a class="reference-link" href="../../Theme%20development/Creating%20an%20icon%20pack.md">Creating an icon pack</a>.

## Using an icon from an icon pack

After [refreshing the application](../../Troubleshooting/Refreshing%20the%20application.md), the icon pack should be enabled by default. To test this, simply select an existing note or create a new one and try to change the note icon.

There should be a _Filter_ button to the right of the search bar in the icon list. Clicking it allows filtering by icon pack and the newly imported icon pack should be displayed there.

> [!NOTE]
> If the icon pack is missing from that list, then most likely there's something wrong with it.
> 
> *   Try checking the <a class="reference-link" href="../../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a> for clues and make sure that the icon pack has the `#iconPack` [label](../../Advanced%20Usage/Attributes/Labels.md) with a value assigned to it (a prefix).
> *   Icon packs that are [protected](../Notes/Protected%20Notes.md) are ignored.

## Integration with the share and export functionality

Custom icon packs are also supported by the <a class="reference-link" href="../../Advanced%20Usage/Sharing.md">Sharing</a> feature, where they will be shown in the note tree. However, in order for an icon pack to be visible to the share function, the icon pack note must also be shared.

If you are using a custom share theme, make sure it supports the `iconPackCss`, otherwise icons will not show up. Check the original share template source code for reference.

Custom icon packs will also be preserved when <a class="reference-link" href="../../Advanced%20Usage/Sharing/Exporting%20static%20HTML%20for%20web%20.md">Exporting static HTML for web publishing</a>. In this case, there's no requirement to make the icon pack shared.

## What happens if I remove an icon pack

If an icon pack is removed or disabled (by removing or altering its `#iconPack` label), all the notes that use this icon pack will show in the <a class="reference-link" href="../UI%20Elements/Note%20Tree.md">Note Tree</a> with no icon. This won't cause any issues apart from looking strange.

The solution is to replace the icons with some else, try using <a class="reference-link" href="../Navigation/Search.md">Search</a> which supports bulk actions, to identify the notes with the now deleted icon pack (by looking for the prefix) and changing or removing their `iconClass`.