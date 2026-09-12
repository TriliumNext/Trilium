# Backup
Trilium supports simple backup scheme where it saves copy of the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> on these events:

*   once a day
*   once a week
*   once a month
*   before DB migration to newer version

So in total you'll have at most 4 backups from different points in time which should protect you from various problems. These backups are stored by default in `backup` directory placed in the [data directory](Data%20directory.md).

This is only very basic backup solution, and you're encouraged to add some better backup solution - e.g. backing up the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> to cloud / different computer etc.

Note that <a class="reference-link" href="Synchronization.md">Synchronization</a> provides also some backup capabilities by its nature of distributing the data to other computers.

## Creating a backup

### On the desktop application and web client:

1.  Go to **Settings → Backup** and press the **Backup Now** button.
2.  The backup creation process may take a few moments, especially for larger databases. A notification will inform you when the backup is complete.
3.  The backup will be saved as **backup-now** in the **Existing Backups** list, where you can download it.

### On the standalone client

1.  **Go to Settings → Backup** and press the "**Download backup**" button.
2.  You will be prompted to **restart the app**. Confirm, and the app will restart automatically.
3.  Set a **backup name** or **password** (both optional), then press "**Continue**".
4.  Press the "**Generate and download"** button and wait for the download to complete.
5.  Once you confirm the download is saved on your device, press **"Finish"** to complete

## Downloading a backup

*   **Desktop and web client**: to download an existing backup, navigate to **Settings → Backup → Existing backups** and select **Download**.
*   **Standalone client**: automatic backups are not supported in this version. You can manually create and download a backup by going to **Settings → Backup → Download backup.**

## Restoring a backup

*   **For a new Trilium instance**: When setting up a new Trilium instance, use the "Restore from backup" option in the setup menu to guide you through restoring your existing backup.
*   **For an existing Trilium instance**: To restore a backup and replace your current database, go to **Settings → Backup** and click **Restore a backup**. You will be prompted to restart the app for the restoration process to begin. After restarting, you can choose to back up the existing database before overwriting it. Note: For the web client, use the Start Over feature (**Settings → Database → Start over**) to switch to the setup screen and restore a backup.

Next, select the backup file (.db or .tnbackup) from your device. The web client is optimized for handling large backups and is resilient to unstable network conditions, similar to the desktop application.

If your database is encrypted, you will be prompted to enter the password used for encrypting the backup file. Without the correct password, decryption and restoration cannot proceed.

Restoring a backup may take some time, depending on its size. Once it completes, Trilium will open the freshly restored database.

### The alternative way for restoring a backup

Let's assume you want to restore the weekly backup (only in .db format, .tnbackup files are not supported by this method), here's how to do it:

*   find [data directory](Data%20directory.md) Trilium uses - easy way is to open "About Trilium Notes" from "Menu" in upper left corner and looking at "data directory"
    *   I'll refer to `~/trilium-data` as data directory from now on
*   find `~/trilium-data/backup/backup-weekly.db` - this is the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> backup.
*   at this point stop/kill Trilium
*   delete `~/trilium-data/document.db`, `~/trilium-data/document.db-wal` and `~/trilium-data/document.db-shm` (latter two files are auto generated)
*   copy and rename this `~/trilium-data/backup/backup-weekly.db` to `~/trilium-data/document.db`
*   make sure that the file is writable, e.g. with `chmod 600 document.db`
*   start Trilium again

> [!WARNING]
> If you have configured sync then you need to do it across all members of the sync cluster, otherwise older version (restored backup) of the document will be detected and synced to the newer version.

## Changing the backup location in Trilium (desktop only)

Starting with version 0.105, the Trilium desktop client allows users to change the directory where backups are stored. Follow these steps to specify a custom backup directory:

1.  Navigate to **Settings** → **Backup Location**.
2.  Click the **Select Location** button.
3.  Choose any writable directory on your file system. This could include network shares, depending on your operating system.

Once you set a custom directory, all manual and automatic backups will be saved there. If the selected directory becomes unavailable, backups may fail or revert to the default location.

> [!TIP]
> For better privacy when using unsafe backup locations, you can enable backup encryption, which makes the backup file unreadable without the correct password.

## Backup encryption

Trilium can secure the entire content of the database backup, ensuring it remains unreadable unless the correct password is provided. This is particularly useful for storing backups in unsecured locations, like network shares, unencrypted external drives, or cloud services. 

Encrypted database backups use the Trilium Backup Container (.tnbackup) format, which relies on AES-256-GCM. This authenticated encryption mode scrambles the data and generates a tag confirming it hasn't been altered. The password itself isn't directly used as the key; it's processed through scrypt, a key derivation function designed to be slow and memory-intensive, making brute-force password guessing difficult even with powerful hardware. Each backup also receives a random 16-byte salt, ensuring that the same password never produces the same encryption key twice. Additionally, critical metadata such as chunk order, length, and header flags are cryptographically bound into the encryption (via "additional authenticated data"), preventing undetected tampering like reorder, truncate, or splice operations.

### Enabling backup encryption

To enable encryption for automatic backups in the Desktop application:

1.  Go to **Settings → Backup → Backup Options**.
2.  Click on **Turn on Encryption** and set a password.

Once encryption is enabled, all newly created backups (both automatic and manual) will be encrypted with the specified password. Backups created prior to enabling encryption will remain unsecured.

You can change the password anytime using the **Change Password** button. The new password will apply to backups created after the change.

To disable encryption, uncheck **Settings → Backup → Enable Encryption**.

> [!NOTE]
> On some systems, a keyring may not be available for Trilium to securely store the encryption password. In such cases, the encryption option is disabled.

## Backup compression

Database backups can be optionally compressed to minimize storage footprint. This method is effective primarily when the database consists largely of text content. However, media files (images, videos, audio), along with PDF, ODF, and DOCX files, are already compressed in their original formats and won't benefit from further compression.

Compressed backups are stored using the Trilium Backup Container (.tnbackup), employing RFC 1952 GZIP compression.

> [!WARNING]
> **Note:** Compression increases the time required for backup creation and restoration. It may also lead to higher CPU usage during automatic backups, potentially draining the battery faster on battery-powered devices. Enable this option only if necessary.

### Enabling Backup Compression (Desktop Only)

To enable compression for new automatic and manual backups, navigate to **Settings → Backup → Backup Options** and toggle **Enable Compression** to on.

## Disabling backup

Although this is not recommended, it is possible to disable backup in `config.ini` in the [data directory](Data%20directory.md):

```
[General]
... some other configs
# set to true to disable backups (e.g. because of limited space on server)
noBackup=true
```

You can also review the [configuration](../Advanced%20Usage/Configuration%20\(config.ini%20or%20environment%20variables\).md) file to provide all `config.ini` values as environment variables instead.

See [sample config](https://github.com/TriliumNext/Trilium/blob/master/config-sample.ini).