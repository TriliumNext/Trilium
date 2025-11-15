# Backup
Trilium supports simple backup scheme where it saves copy of the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> on these events:

*   once a day
*   once a week
*   once a month
*   before DB migration to newer version

So in total you'll have at most 4 backups from different points in time which should protect you from various problems. These backups are stored by default in `backup` directory placed in the [data directory](Data%20directory.md).

This is only very basic backup solution, and you're encouraged to add some better backup solution - e.g. backing up the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> to cloud / different computer etc.

Note that <a class="reference-link" href="Synchronization.md">Synchronization</a> provides also some backup capabilities by its nature of distributing the data to other computers.

## External Blob Storage and Backups

If you have enabled <a class="reference-link" href="../Advanced%20Usage/External%20Blob%20Storage.md">external blob storage</a>, you must backup both the database and the `external-blobs` directory. Without backing up `external-blobs` separately, you would lose large attachments if restoring from backup.

By default, external blob storage is disabled, meaning all attachments are stored in the database and the automatic backup described above is sufficient.

### How to Backup with External Blobs

When external blob storage is enabled, backup the complete [data directory](Data%20directory.md) which includes both the database and `external-blobs`. This is the simplest approach and ensures nothing is missed.

To ensure consistency, either stop Trilium before backing up, or use a filesystem snapshot tool (e.g., LVM snapshots, ZFS snapshots, or volume shadow copy on Windows) to capture both the database and `external-blobs` directory at the same point in time.

## Restoring backup

Let's assume you want to restore the weekly backup, here's how to do it:

*   find [data directory](Data%20directory.md) Trilium uses - easy way is to open "About Trilium Notes" from "Menu" in upper left corner and looking at "data directory"
    *   I'll refer to `~/trilium-data` as data directory from now on
*   find `~/trilium-data/backup/backup-weekly.db` - this is the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> backup
*   at this point stop/kill Trilium
*   delete `~/trilium-data/document.db`, `~/trilium-data/document.db-wal` and `~/trilium-data/document.db-shm` (latter two files are auto generated)
*   copy and rename this `~/trilium-data/backup/backup-weekly.db` to `~/trilium-data/document.db`
*   make sure that the file is writable, e.g. with `chmod 600 document.db`
*   if you have external blob storage enabled, also restore the `external-blobs` directory from your backup
*   start Trilium again

If you have configured sync then you need to do it across all members of the sync cluster, otherwise older version (restored backup) of the document will be detected and synced to the newer version.

## Disabling backup

Although this is not recommended, it is possible to disable backup in `config.ini` in the [data directory](Data%20directory.md):

```
[General]
... some other configs
# set to true to disable backups (e.g. because of limited space on server)
noBackup=true
```

You can also review the [configuration](../Advanced%20Usage/Configuration%20\(config.ini%20or%20e.md) file to provide all `config.ini` values as environment variables instead.

See [sample config](https://github.com/TriliumNext/Trilium/blob/master/config-sample.ini).