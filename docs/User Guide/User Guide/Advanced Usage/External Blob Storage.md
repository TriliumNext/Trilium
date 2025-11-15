# External Blob Storage
External blob storage is an optional feature that stores large attachments as separate files on the filesystem instead of embedding them in the SQLite database. This feature is disabled by default to maintain backward compatibility and simplicity for most users.

## When to Enable External Blob Storage

### Benefits of enabling external storage:

*   **Performance**: Large attachments don't bloat the database, which can improve query performance
*   **Backup flexibility**: Large files can be backed up separately from the database using different strategies or schedules
*   **Storage efficiency**: Easier to manage and migrate large files independently

### When to keep it disabled (default):

*   **Simplicity**: All data in one database file makes backup and migration straightforward
*   **Small attachments**: If your attachments are mostly small, database storage is more efficient
*   **Portability**: Single-file database is easier to copy and move between systems

## How It Works

When external blob storage is enabled and a note or attachment exceeds the configured threshold size the content is saved to the file system in the `external-blobs` directory within your [data directory](../Installation%20%26%20Setup/Data%20directory.md). The files are organized in a partitioned directory structure to prevent excessive files in a single directory. The database stores a reference to the external file and any additional metadata.

Attachments below the threshold, or when external storage is disabled, continue to be stored in the database.

When you enable external blob storage, existing attachments in the database remain there. Only new attachments that exceed the threshold will be stored externally. Automatically migrating existing attachments is currently not supported.

If you disable external blob storage after using it, existing external blobs remain in the `external-blobs` directory and continue to work. New attachments will be stored in the database regardless of size.

## Configuration

External blob storage can be configured via `config.ini` or environment variables. See the [Configuration](Configuration%20\(config.ini%20or%20e.md) documentation for all available options.

## Threshold Size Recommendations

The default threshold of 100KB (102400 bytes) is based on [SQLite's performance recommendations](https://www.sqlite.org/intern-v-extern-blob.html).

You can adjust the threshold based on your needs:

*   **Lower threshold (e.g., 50KB)**: More files stored externally, smaller database
*   **Higher threshold (e.g., 1MB)**: Fewer external files, larger database but simpler backup

## Important Backup Considerations

When external blob storage is enabled, you must backup both the database and the `external-blobs` directory.

Without backing up the `external-blobs` directory, you would lose large attachments if restoring from backup.

See the [Backup](../Installation%20%26%20Setup/Backup.md) documentation for detailed backup strategies with external blob storage.