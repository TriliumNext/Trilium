# Downloaded resources
Downloaded resources are large files that some features need but that do not ship with Trilium, such as the speech recognition models used to transcribe meetings. Trilium downloads them the first time a feature needs them, and keeps them on the device for later use.

Currently, only <a class="reference-link" href="../Meeting%20transcription.md">Meeting transcription</a> on the desktop application uses downloaded resources:

| Resource | Size | License | Used for |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 (standard) | 0.6 GB | CC-BY-4.0 | Recognizing speech, with the _Standard_ model. |
| Parakeet TDT 0.6B v3 (high accuracy) | 2.4 GB | CC-BY-4.0 | Recognizing speech, with the _High accuracy_ model. |
| Silero VAD | 0.6 MB | MIT | Detecting when someone speaks. |
| TitaNet | 40 MB | Apache-2.0 | Telling speakers apart, while _Identify speakers_ is on. |

## Downloading resources

When a feature needs resources that are not on the device yet, Trilium asks before downloading them. The dialog lists each resource with what it is used for, where it is downloaded from, its license and its size, followed by the total download size and the free space on the disk.

*   To start the download, press _Download_. Each resource shows its progress, and the feature continues once all of them are downloaded.
*   To stop the download, press _Cancel_ or close the dialog. The files already downloaded are kept, and the next download continues where this one stopped, even within a large file.
*   If the disk does not have enough free space, the dialog says so and the download cannot be started.

Every file is checked against a checksum built into Trilium before it is used, so a file that was damaged or altered during the download is discarded.

> [!NOTE]
> Downloaded resources are not synchronized. Each device that uses a feature downloads its resources separately, even when the notes are kept in sync through <a class="reference-link" href="Synchronization.md">Synchronization</a>.

## Managing downloaded resources

To see the downloaded resources, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Downloaded resources_. Each resource that was downloaded, or partly downloaded by an interrupted download, is listed with the space it takes on the disk and its status. Below the list, _Space used_ shows the space they take in total, and how much free space is left on the disk.

*   To open the folder of a resource, press the <span class="tn-icon bx bx-folder-open"></span> button (desktop only).
*   To delete a resource, press the <span class="tn-icon bx bx-trash"></span> button. If a feature needs it again, it is downloaded again.

The list also shows, faded out, anything else in the resources folder:

*   _Older version_: the files of an earlier version of a resource. When a resource is updated, the new version is downloaded into a new folder, and the old one is left behind.
*   _Not used_: a resource that no feature of this installation uses, for example one downloaded by a feature that was removed.
*   _Unknown_: any other file or folder, for example one copied there by hand.

These can be deleted in the same way.

> [!WARNING]
> If a server and a desktop application share the same data directory, a resource used by only one of them shows as _Not used_ in the other. Deleting it there removes it for both.

## Location

The resources are stored in the `resources` folder of the <a class="reference-link" href="Data%20directory.md">Data directory</a>, one folder per resource. To store them elsewhere, set the `TRILIUM_RESOURCES_DIR` environment variable to another folder before starting Trilium.

## Installing without an Internet connection

To install a resource on a device that cannot download it, copy its folder from the `resources` folder of a device that already has it into the same place on the other device. The next time a feature asks to download it, press _Download_: the files already in place are checked against their checksums and kept, and only the missing ones are downloaded.