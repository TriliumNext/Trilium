# Backup
Trilium supports simple backup scheme where it saves copy of the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> on these events:

*   once a day
*   once a week
*   once a month
*   before DB migration to newer version

So in total you'll have at most 4 backups from different points in time which should protect you from various problems. These backups are stored by default in `backup` directory placed in the [data directory](Data%20directory.md).

This is only very basic backup solution, and you're encouraged to add some better backup solution - e.g. backing up the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> to cloud / different computer etc.

Note that <a class="reference-link" href="Synchronization.md">Synchronization</a> provides also some backup capabilities by its nature of distributing the data to other computers.

## Downloading backup

You can download an existing backup by going to Settings > Backup > Existing backups > Download

## Restoring backup

Let's assume you want to restore the weekly backup, here's how to do it:

*   find [data directory](Data%20directory.md) Trilium uses - easy way is to open "About Trilium Notes" from "Menu" in upper left corner and looking at "data directory"
    *   I'll refer to `~/trilium-data` as data directory from now on
*   find `~/trilium-data/backup/backup-weekly.db` - this is the <a class="reference-link" href="../Advanced%20Usage/Database.md">Database</a> backup
*   at this point stop/kill Trilium
*   delete `~/trilium-data/document.db`, `~/trilium-data/document.db-wal` and `~/trilium-data/document.db-shm` (latter two files are auto generated)
*   copy and rename this `~/trilium-data/backup/backup-weekly.db` to `~/trilium-data/document.db`
*   make sure that the file is writable, e.g. with `chmod 600 document.db`
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