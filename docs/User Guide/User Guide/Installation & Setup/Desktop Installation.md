# Desktop Installation
To install Trilium on your desktop, follow these steps:

1.  **Download the Latest Release**: Obtain the appropriate binary release for your operating system from the [latest release page](https://github.com/TriliumNext/Trilium/releases/latest) on GitHub.
2.  **Extract the Package**: Unzip the downloaded package to a location of your choice.
3.  **Run the Application**: Launch Trilium by executing the `trilium` executable found within the unzipped folder.

## Installing from Flathub

On Linux, Trilium is also available on [Flathub](https://flathub.org/en/apps/org.triliumnotes.Trilium), for both x86\_64 and ARM (aarch64). Install it from your software center (e.g. GNOME Software or KDE Discover), or from a terminal:

```sh
flatpak install flathub org.triliumnotes.Trilium
```

Updates arrive through the software center or `flatpak update`, like any other Flatpak.

The Flathub version runs in a sandbox and keeps its [data directory](Data%20directory.md) in `~/.var/app/org.triliumnotes.Trilium/data/trilium-data`. It cannot see the data directory of a `.deb`, `.rpm`, AppImage or `.zip` installation (`~/.local/share/trilium-data`), so it starts with an empty database. To bring existing notes over:

1.  Close Trilium, in both the old installation and the Flatpak.
2.  Copy the old data directory into the sandbox:
    
    ```sh
    mkdir -p ~/.var/app/org.triliumnotes.Trilium/data
    cp -a ~/.local/share/trilium-data ~/.var/app/org.triliumnotes.Trilium/data/
    ```
3.  Start the Flatpak version.

If `~/.var/app/org.triliumnotes.Trilium/data/trilium-data` already exists because the Flatpak version was started before, remove or rename it first.

## Startup Scripts

Trilium offers various startup scripts to customize your experience:

*   `trilium-no-cert-check`: Starts Trilium without validating [TLS certificates](Server%20Installation/HTTPS%20\(TLS\).md), useful if connecting to a server with a self-signed certificate.
    *   Alternatively, set the `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable before starting Trilium.
*   `trilium-portable`: Launches Trilium in portable mode, where the [data directory](Data%20directory.md) is created within the application's directory, making it easy to move the entire setup. Electron's internal data (caches, dictionaries, etc.) is also stored within the data directory, so no files are written to the system's roaming profile.
*   `trilium-safe-mode`: Boots Trilium in "safe mode," disabling any startup scripts that might cause the application to crash.

## Synchronization

For Trilium desktop users who wish to synchronize their data with a server instance, refer to the <a class="reference-link" href="Synchronization.md">Synchronization</a> guide for detailed instructions.