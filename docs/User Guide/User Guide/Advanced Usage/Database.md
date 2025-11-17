# Database
Your Trilium data is stored in a [SQLite](https://www.sqlite.org) database which contains all notes, tree structure, metadata, and most of the configuration. The database file is named `document.db` and is stored in the application's default [Data directory](../Installation%20%26%20Setup/Data%20directory.md).

By default, all note and attachment content is stored within the database. However, when [external blob storage](External%20Blob%20Storage.md) is enabled, large notes and attachments are stored separately in the `external-blobs` directory for better performance and backup flexibility.

## Demo Notes

When first starting Trilium, it will provide a set of notes to showcase various features of the application.

For more information see <a class="reference-link" href="Database/Demo%20Notes.md">Demo Notes</a>.

## Manually Modifying the Database

Trilium provides a lot of flexibility, and with it, opportunities for advanced users to tweak it. If you need to explore or modify the database directly, you can use a tool such as [SQLite Browser](https://sqlitebrowser.org/) to work directly on the database file.

See [Manually altering the database](Database/Manually%20altering%20the%20database.md) for more information.

## How to Reset the Database

If you are experimenting with Trilium and want to return it to its original state, you can do that by deleting the current database. When you restart the application, it will generate a new database containing the original demo notes.

To delete the database, simply go to the [data directory](../Installation%20%26%20Setup/Data%20directory.md) and delete the `document.db` file (and any other files starting with `document.db`).

If you do not need to preserve any configurations that might be stored in the `config.ini` file, you can just delete all of the [data directory's](../Installation%20%26%20Setup/Data%20directory.md) contents to fully restore the application to its original state. You can also review the [configuration](Configuration%20\(config.ini%20or%20e.md) file to provide all `config.ini` values as environment variables instead.