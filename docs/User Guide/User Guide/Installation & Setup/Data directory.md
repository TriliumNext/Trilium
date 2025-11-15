# Data directory
Data directory contains:

*   `document.db` - [database](../Advanced%20Usage/Database.md)
*   `config.ini` - instance level settings like port on which the Trilium application runs
*   `backup` - contains automatically [backup](Backup.md) of documents
*   `log` - contains application log files
*   `external-blobs` - contains large attachments when [external blob storage](../Advanced%20Usage/External%20Blob%20Storage.md) is enabled (optional, not present by default)

## Location of the data directory

Easy way how to find out which data directory Trilium uses is to look at the "About Trilium Notes" dialog (from "Menu" in upper left corner):

![](Data%20directory_image.png)

Here's how the location is decided:

Data directory is normally named `trilium-data` and it is stored in:

*   `/home/[user]/.local/share` for Linux
*   `C:\Users\[user]\AppData\Roaming` for Windows Vista and up
*   `/Users/[user]/Library/Application Support` for Mac OS
*   user's home is a fallback if some of the paths above don't exist
*   user's home is also a default setup for \[\[docker|Docker server installation\]\]

If you want to back up your Trilium data, just backup this single directory - it contains everything you need.

### Changing the location of data directory

If you want to use some other location for the data directory than the default one, you may change it via `TRILIUM_DATA_DIR` environment variable to some other location:

### Windows

1.  Press the Windows key on your keyboard.
2.  Search and select “Edit the system variables”.
3.  Press the “Environment Variables…” button in the bottom-right of the newly opened screen.
4.  On the top section ("User variables for \[user\]"), press the “New…” button.
5.  In the _Variable name_ field insert `TRILIUM_DATA_DIR`.
6.  Press the _Browse Directory…_ button and select the new directory where to store the database.
7.  Close all the windows by pressing the _OK_ button for each of them.

#### Linux

```
export TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data
```

#### Mac OS X

You need to create a `.plist` file under `~/Library/LaunchAgents` to load it properly each login.

To load it manually, you need to use `launchctl setenv TRILIUM_DATA_DIR <yourpath>`

Here is a pre-defined template, where you just need to add your path to:

```
        Label
        set.trilium.env
        RunAtLoad
        
        ProgramArguments
        
            launchctl
            setenv
            TRILIUM_DATA_DIR
            /Users/YourUserName/Library/Application Support/trilium-data    
```

### Create a script to run with specific data directory

An alternative to globally setting environment variable is to run only the Trilium Notes with this environment variable. This then allows for different setup styles like two [database](../Advanced%20Usage/Database.md) instances or "portable" installation.

To do this in Unix-based systems simply run `trilium` like this:

```
TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data trilium
```

You can then save the above command as a shell script on your path for convenience.

## Fine-grained directory/path location

Apart from the data directory, some of the subdirectories of it can be moved elsewhere by changing an environment variable:

| Environment variable | Default value | Description |
| --- | --- | --- |
| `TRILIUM_DOCUMENT_PATH` | `${TRILIUM_DATA_DIR}/document.db` | Path to the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> (storing all notes and metadata). |
| `TRILIUM_BACKUP_DIR` | `${TRILIUM_DATA_DIR}/backup` | Directory where automated <a class="reference-link" href="Backup.md">Backup</a> databases are stored. |
| `TRILIUM_LOG_DIR` | `${TRILIUM_DATA_DIR}/log` | Directory where daily <a class="reference-link" href="../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a> are stored. |
| `TRILIUM_TMP_DIR` | `${TRILIUM_DATA_DIR}/tmp` | Directory where temporary files are stored (for example when opening in an external app). |
| `TRILIUM_ANONYMIZED_DB_DIR` | `${TRILIUM_DATA_DIR}/anonymized-db` | Directory where a <a class="reference-link" href="../Troubleshooting/Anonymized%20Database.md">Anonymized Database</a> is stored. |
| `TRILIUM_CONFIG_INI_PATH` | `${TRILIUM_DATA_DIR}/config.ini` | Path to <a class="reference-link" href="../Advanced%20Usage/Configuration%20(config.ini%20or%20e.md">Configuration (config.ini or environment variables)</a> file. |