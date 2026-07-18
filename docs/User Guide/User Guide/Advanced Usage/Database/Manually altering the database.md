# Manually altering the database
There are some situations where modifying the SQLite database that Trilium uses is desirable.

If you are doing any advanced development or troubleshooting where you manually modify the database, you might want to consider creating backups of your `document.db` file.

## Modifying it internally using the SQL Console

The SQL Console is Trilium's built-in database editor.

See <a class="reference-link" href="Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a>.

## Externally modifying the database

Sometimes the SQL Console cannot be used (for example if the application cannot start).

When making external modifications, consider closing the desktop application. If modifying the server database, then stop the service or Docker container.

### Using DB Browser for SQLite

DB Browser for SQLite is a cross-platform editor that can be used to alter the database using a graphical user interface.

To do so:

1.  In the main menu, select File → Open database… and navigate to the database in the [Data directory](../../Installation%20%26%20Setup/Data%20directory.md).
2.  Select the _Execute SQL_ tab.
3.  Type in the desired SQL statement.
4.  Press the "Play" button in the toolbar underneath the "Execute SQL" tab (or F5 key).
5.  Press "Write Changes" in the main toolbar.
6.  Close the application or close the database.

![](Manually%20altering%20the%20database_image.png)

### Using the SQLite CLI

First, start the SQLite 3 CLI by specifying the path to the database:

```
sqlite3 ~/.local/share/trilium-data/document.db
```

*   In the prompt simply type the statement and make sure it ends with a `;` character.
*   To exit, simply type `.quit` and enter.