# Privacy Policy
This policy covers Trilium Notes on desktop, server, web (standalone) and Android, the Trilium Web Clipper and Trilium Sender for Android.

## Summary

Trilium does not collect any data from your installation. There are no analytics, no telemetry, no crash reporting and no advertising. The Trilium project runs no service that receives your notes or your usage. Your notes stay on the devices and servers you install Trilium on, and they travel only between instances you set up yourself (such as a sync server).

## Trilium Notes

### Where your data is stored

*   On desktop and server, notes are stored in a database file in the data directory of your installation.
*   In the web (standalone) version and the Android app, notes are stored in the private storage of the browser or the app on your device.

The project has no copy of this data and no way to access it.

### Automatic network activity

*   The desktop and server versions periodically ask GitHub ([https://api.github.com/repos/TriliumNext/Trilium/releases/latest](https://api.github.com/repos/TriliumNext/Trilium/releases/latest)) whether a new stable version is out. This only checks; nothing is downloaded or installed. You can turn it off in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_. The web version and the Android app don't check for updates.
*   The desktop version downloads spell-checking dictionaries as needed for the languages selected in its settings.

### Network activity you initiate

Some features contact other services, only when you use them:

*   **Synchronization** sends your notes to the sync server you configure. The connection uses your own server; the project is not involved.
*   **AI features** send the prompts and the note content you share with them to the AI provider you configure, under that provider's privacy policy. They are off until you set up a provider.
*   **Geo maps** load map tiles from the configured tile provider (by default, OpenStreetMap or VersaTiles). Like any map, these requests reveal which area you are viewing.
*   **Web view notes, embedded images and links** load content from the addresses you put in your notes.

### Android permissions

The Android app requests:

*   **Internet**, for synchronization and the features listed above.
*   **Location** (approximate and precise), only when you press the locate button on a geo map. Your location is used to center the map on the device and is not stored or sent to the project. Denying the permission only disables that button.

### Google Play

When you install the Android app from Google Play, Google handles the download and may collect data under [Google's privacy policy](https://policies.google.com/privacy). The project receives only the aggregate statistics Google Play Console provides to every developer (such as install counts).

## Trilium Web Clipper

Trilium Web Clipper does not collect or send any data, i.e. no analytics, no telemetry etc. It sends the pages and selections you clip only to the Trilium instance you connect it to.

## Trilium Sender for Android

Trilium Sender for Android does not collect or send any data, i.e. no analytics, no telemetry etc. It sends what you share with it only to the Trilium instance you connect it to.

## Contact

Questions about this policy can be asked on [GitHub](https://github.com/TriliumNext/Trilium/issues).