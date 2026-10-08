# Data directory
Data directory contains:

*   `document.db` - [database](../Advanced%20Usage/Database.md)
*   `config.ini` - instance level settings like port on which the Trilium application runs
*   `backup` - contains automatically [backup](Backup.md) of documents
*   `log` - contains application log files

## Location of the data directory

Easy way how to find out which data directory Trilium uses is to look at the "About Trilium Notes" dialog (from "Menu" in upper left corner):

![](Data%20directory_image.png)

Here's how the location is decided:

Data directory is normally named `trilium-data` and it is stored in:

*   `/home/[user]/.local/share` for Linux
*   `/home/[user]/.var/app/org.triliumnotes.Trilium/data` for the Flathub version on Linux
*   `C:\Users\[user]\AppData\Roaming` for Windows Vista and up
*   `/Users/[user]/Library/Application Support` for Mac OS
*   user's home is a fallback if some of the paths above don't exist
*   user's home is also a default setup for \[\[docker|Docker server installation\]\]

If you want to back up your Trilium data, just backup this single directory - it contains everything you need.

### Changing the location of data directory

If you want to use some other location for the data directory than the default one, you may change it via `TRILIUM_DATA_DIR` environment variable to some other location:

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    1.  Press the <span class="tn-icon bx bxl-windows"></span> key on your keyboard.
    2.  Search and select _Edit the system variables_.
    3.  Press the _Environment Variables…_ button in the bottom-right of the newly opened screen.
    4.  On the top section (_User variables for \[user\]_), press the _New…_ button.
    5.  In the _Variable name_ field insert `TRILIUM_DATA_DIR`.
    6.  Press the _Browse Directory…_ button and select the new directory where to store the database.
    7.  Close all the windows by pressing the _OK_ button for each of them.

=== "<span class="tn-icon bx bxl-tux"></span> Linux"

    Trilium reads `TRILIUM_DATA_DIR` when it starts, so the variable must be set in the environment that launches it.

    > [!NOTE]
    > Setting the variable does not move existing notes. To keep them, close Trilium and copy the old data directory to the new location first. Trilium creates the last folder of the path if it is missing, but not its parent folders.

    **Desktop application (.deb, .rpm, AppImage or .zip)**

    To use the new location however Trilium is started (from the application menu, a desktop shortcut, at login or from a terminal), set the variable for the whole session:

    1.  Create the file `~/.config/environment.d/trilium.conf` with the following content, using the full path (`~` is not expanded in this file):
        
        ```
        TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data
        ```
    2.  Log out and log back in.

    This works on desktops started by `systemd`, which covers most distributions running GNOME or KDE Plasma. On other systems, add the following line to `~/.profile` instead, then log out and log back in:

    ```sh
    export TRILIUM_DATA_DIR="$HOME/data/my-trilium-data"
    ```

    The same line in `~/.bashrc` (or your shell's equivalent) only applies when Trilium is started from a terminal, not from the application menu.

    **Flatpak (Flathub)**

    The Flathub version runs in a sandbox that cannot see the rest of the file system, so it needs access to the folder as well as the variable:

    ```sh
    flatpak override --user \
        --env=TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data \
        --filesystem=/home/myuser/data/my-trilium-data:create \
        org.triliumnotes.Trilium
    ```

    To return to the default location, run `flatpak override --user --reset org.triliumnotes.Trilium`. This also removes any other overrides set for Trilium.

    **Server running as a systemd service**

    Add an `Environment=` line to the `[Service]` section of the unit file described in <a class="reference-link" href="Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.md">Packaged version for Linux</a>:

    ```
    [Service]
    Environment=TRILIUM_DATA_DIR=/var/lib/trilium-data
    ```

    Then reload and restart the service:

    ```sh
    sudo systemctl daemon-reload
    sudo systemctl restart trilium
    ```

    The user set in `User=` must be able to write to the folder. For Docker, see <a class="reference-link" href="Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md">Using Docker</a> instead.

=== "<span class="tn-icon bx bxl-apple"></span> macOS"

    You need to create a `.plist` file under `~/Library/LaunchAgents` to load it properly each login.

    To load it manually, you need to use `launchctl setenv TRILIUM_DATA_DIR <yourpath>`

    Here is a pre-defined template, where you just need to add your path to:

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>Label</key>
        <string>set.trilium.env</string>
        <key>RunAtLoad</key>
        <true/>
        <key>ProgramArguments</key>
        <array>
            <string>/bin/launchctl</string>
            <string>setenv</string>
            <string>TRILIUM_DATA_DIR</string>
            <string>/Users/YourUserName/Library/Application Support/trilium-data</string>
        </array>
    </dict>
    </plist>

    ```

### Create a script to run with specific data directory

An alternative to globally setting environment variable is to run only the Trilium Notes with this environment variable. This then allows for different setup styles like two [database](../Advanced%20Usage/Database.md) instances or "portable" installation.

To do this in Unix-based systems simply run `trilium` like this:

```
TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data trilium
```

You can then save the above command as a shell script on your path for convenience.

## Electron user data directory (desktop only)

When running the desktop application, Electron stores internal data (caches, spell-check dictionaries, session storage, etc.) separately from the Trilium data directory. By default this goes to the system's application data folder (e.g. `%APPDATA%` on Windows), which may be undesirable in corporate environments with roaming profiles or when running in portable mode.

To keep Electron data out of the system's roaming profile, set the `TRILIUM_ELECTRON_DATA_DIR` environment variable to an explicit path. The `trilium-portable` script does this automatically, pointing it to `trilium-electron-data/` next to the application.

## Fine-grained directory/path location

Apart from the data directory, some of the subdirectories of it can be moved elsewhere by changing an environment variable:

| Environment variable | Default value | Description |
| --- | --- | --- |
| `TRILIUM_DOCUMENT_PATH` | `${TRILIUM_DATA_DIR}/document.db` | Path to the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> (storing all notes and metadata). |
| `TRILIUM_BACKUP_DIR` | `${TRILIUM_DATA_DIR}/backup` | Directory where automated <a class="reference-link" href="Backup.md">Backup</a> databases are stored. |
| `TRILIUM_LOG_DIR` | `${TRILIUM_DATA_DIR}/log` | Directory where daily <a class="reference-link" href="../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a> are stored. |
| `TRILIUM_TMP_DIR` | `${TRILIUM_DATA_DIR}/tmp` | Directory where temporary files are stored (for example when opening in an external app). |
| `TRILIUM_ANONYMIZED_DB_DIR` | `${TRILIUM_DATA_DIR}/anonymized-db` | Directory where a <a class="reference-link" href="../Troubleshooting/Anonymized%20Database.md">Anonymized Database</a> is stored. |
| `TRILIUM_CONFIG_INI_PATH` | `${TRILIUM_DATA_DIR}/config.ini` | Path to <a class="reference-link" href="../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md">Configuration (config.ini or environment variables)</a> file. |
| `TRILIUM_ELECTRON_DATA_DIR` | System appData | Directory for Electron internal data (caches, spell-check dictionaries, etc.). Set this in portable mode to avoid writing to the system profile (desktop only). |