# Backend (server) logs
## Accessing via the backend log

In the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>, go to _Advanced_ → _Backend log_. This will display the current backend log (i.e. today's), with the historical information available only on disk (see below).

The log is colored to make it easier to read: request status codes by class, slow SQL queries, and errors in red. The statement of a slow SQL query is highlighted the same way as in the <a class="reference-link" href="../../Advanced%20Usage/Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a>, using the color scheme of code notes (see _Color schemes_ in <a class="reference-link" href="../../Note%20Types/Code.md">Code</a>).

A search that the app runs in the background, for example to filter a collection, or that a script runs is followed by a `Search:` line with its query and the number of notes it returned. The query is highlighted the same way as in a <a class="reference-link" href="../../Note%20Types/Saved%20Search.md">Saved Search</a>. Quick search and saved searches don't add this line.

Interaction since v0.104.0:

*   The file can be downloaded as a text file using the <span class="tn-icon bx bx-download"></span> button in the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a> area.
*   The file can also be searched just like a normal <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note.

## Location on the disk

Backend logs are stored on the file system. To find them, open the <a class="reference-link" href="../../Installation%20%26%20Setup/Data%20directory.md">Data directory</a>, go to the `log` subdirectory and find the latest log file, e.g. `trilium-2022-12-14.log`. 

## In the terminal

The server also prints every log entry to its standard output, which is what `docker logs` or `journalctl` show. When that output is a terminal, each entry starts with its time and is colored like the backend log in the app: request status codes by class, slow SQL queries, and errors in red. The statement of a slow SQL query and the query of a search are shown without syntax highlighting there. The startup banner with the Trilium logo and version information is colored too. Output to a file, a pipe or a container log stays plain text without the time, since those tools add their own.

To turn the colors off in a terminal, set the `NO_COLOR` environment variable; to force them on elsewhere, set `FORCE_COLOR=1`.

## Reporting backend bugs

You can attach the whole file to the bug report (preferable) or open it and copy-paste only the last lines / lines you believe are relevant.

## Customizing the retention of logs

The backend logs are fully managed by the Trilium server. By default the last 90 days worth of logs are kept; the logs older than that are deleted in order to reduce the space consumption.

It's possible to change the retention period by modifying the <a class="reference-link" href="../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md">Configuration (config.ini or environment variables)</a> via the `.ini` file:

```
[Logging]
retentionDays=7
```

Or via the environment variable `TRILIUM_LOGGING_RETENTION_DAYS`.

Special cases:

*   Positive values indicate the number of days worth of logs to keep
*   A value of 0 results with the default value (90 days) to be used
*   Negative values (e.g. `-1`) result with all logs to be kept, irrespective how ancient and numerous (and

> [!NOTE]
> If you set the retention days to a low number, you might notice that not all the log files are being deleted. This is because a minimum number of logs (7 at the time of writing) is maintained at all times.