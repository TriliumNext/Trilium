# Troubleshooting
While Trilium is actively maintained and stable, encountering bugs is possible.

## General Quick Fix

The first step in troubleshooting is often a restart.

If you experience an UI issue, the frontend may have entered an inconsistent state. Reload the application by pressing <kbd>Ctrl</kbd> + <kbd>R</kbd>. This will reload the frontend.

If the issue persists or appears to be a backend problem, restart the entire application. For the desktop (Electron) build, simply close and reopen the window. If you're using a Docker build, restart the container.

## Broken Note Crashes Trilium

Certain problems, such as rendering a note with a faulty script, can cause Trilium to crash. If Trilium attempts to reload the problematic note upon restart, it will continue to crash.

To resolve this, use the `TRILIUM_START_NOTE_ID` environment variable to reset the open tabs to a single specified note ID (e.g., `root`). In Linux, you can set it as follows:

```
TRILIUM_START_NOTE_ID=root ./trilium
```

## Broken Script Prevents Application Startup

If a custom script causes Trilium to crash, and it is set as a startup script or in an active [custom widget](Scripting/Frontend%20Basics/Custom%20Widgets.md), start Triliumin "safe mode" to prevent any custom scripts from executing:

```
TRILIUM_SAFE_MODE=true ./trilium
```

Depending on your Trilium distribution, you may have pre-made scripts available: `trilium-safe-mode.bat` and `trilium-safe-mode.sh`.

Once Trilium starts, locate and fix or delete the problematic note.

## Sync and Consistency Checks

Trilium periodically verifies the logical consistency of the database (e.g., ensuring every note has a parent). If inconsistencies are detected, you will be notified via the UI.

In such cases, file a bug report and attach an [anonymized database](Troubleshooting/Anonymized%20Database.md) if necessary.

## Restoring Backup

Trilium makes regular automatic backups. If issues become severe, you can [restore from a backup](Installation%20%26%20Setup/Backup.md).

## Forgotten Password

If you forget your password:

*   Protected notes are irretrievable without the password.
*   Unprotected notes can be recovered. Follow these steps:

Access the [database](Advanced%20Usage/Database.md) file in the [data directory](Installation%20%26%20Setup/Data%20directory.md). Open the `document.db` file with an SQLite client (e.g., [DB Browser](https://sqlitebrowser.org/)) and execute the following queries:

```
UPDATE options SET value = '77/twC5O00cuQgNC63VK32qOKKYwj21ev3jZDXoytVU=' WHERE name = 'passwordVerificationSalt';
UPDATE options SET value = '710BMasZCAgibzIc07X4P9Q4TeBd4ONnqJOho+pWcBM=' WHERE name = 'passwordDerivedKeySalt';
UPDATE options SET value = 'Eb8af1/T57b89lCRuS97tPEl4CwxsAWAU7YNJ77oY+s=' WHERE name = 'passwordVerificationHash';
UPDATE options SET value = 'QpC8XoiYYeqHPtHKRtbNxfTHsk+pEBqVBODYp0FkPBa22tlBBKBMigdLu5GNX8Uu' WHERE name = 'encryptedDataKey';
```

After executing the changes, commit/write the changes. **This sets the password to "password," allowing you to log in again.**

For pre-existing protected notes (now unrecoverable), consider deleting them or exporting the unprotected notes. Then, delete `document.db` and start fresh.

If you continue using the existing document file, change your password (Options -> Change Password).

## Reporting Bugs

Reporting bugs is highly valuable. Here are some tips:

*   Use GitHub issues for reporting: [https://github.com/TriliumNext/Trilium/issues](https://github.com/TriliumNext/Trilium/issues)
*   Refer to the [error logs](Troubleshooting/Error%20logs.md) page for information on providing necessary details.