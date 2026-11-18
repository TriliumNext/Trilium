# Anonymized Database
![](Anonymized%20Database_image.jpg)

In certain scenarios, understanding the structure of a database is crucial for troubleshooting issues. However, sharing your actual [database](../Advanced%20Usage/Database.md) file with personal notes is not advisable. To address this, Trilium offers a feature to anonymize the database. This feature can be accessed via Menu -> Options -> Advanced tab.

This feature creates a copy of your database with all sensitive data removed. Specifically, it strips out note titles, contents, revisions, history, and some non-system attributes while retaining the overall structure and metadata, such as modification dates. After anonymization, the database undergoes a [vacuuming process](https://sqlite.org/lang_vacuum.html) to ensure no sensitive data remnants remain in the file. The anonymized database is saved in the `anonymized` directory within the [data directory](../Installation%20%26%20Setup/Data%20directory.md), making it safe to share with bug reports.

This will create a copy of your document and remove all sensitive data (currently note titles, contents, revisions, history and some of the options, and non-system attributes) while leaving all structure and metadata (e.g. date of last change). After this is done, the database is [VACUUMed](https://sqlite.org/lang_vacuum.html) to make sure there's no stale sensitive data in the document file. The resulting file is stored in `anonymized` directory (placed in the [data directory](../Installation%20%26%20Setup/Data%20directory.md)). You can safely attach it to a bug report.

## Command Line Anonymization

If your [database](../Advanced%20Usage/Database.md) is corrupted to the point where Trilium cannot start, the anonymization process can still be executed via the command line:

```
node src/anonymize.js
```

Run this command from the directory containing Trilium's source files, typically found in the `resources/app` directory for desktop builds.