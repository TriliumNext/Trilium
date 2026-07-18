# Resetting your password
> [!IMPORTANT]
> If you forget your password:
> 
> *   Protected notes are irretrievable without the password.
> *   Unprotected notes can be recovered.

There are two options, both involving access to the device that is running your server.

### By disabling authentication

1.  See <a class="reference-link" href="../Authentication.md">Authentication</a> on how to disable the authentication.
2.  Restart the server.
3.  Go to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → Password → Reset password.
4.  Re-enable authentication by following step (1) in reverse.
5.  Restart the server.
6.  Log in with the new password.

### By altering the database

1.  Access the [database](../../../Advanced%20Usage/Database.md) file in the [data directory](../../Data%20directory.md). Open the `document.db` file with an SQLite client (e.g., [DB Browser](https://sqlitebrowser.org/)).
2.  Execute the following queries:
    
    ```
    UPDATE options SET value = '77/twC5O00cuQgNC63VK32qOKKYwj21ev3jZDXoytVU=' WHERE name = 'passwordVerificationSalt';
    UPDATE options SET value = '710BMasZCAgibzIc07X4P9Q4TeBd4ONnqJOho+pWcBM=' WHERE name = 'passwordDerivedKeySalt';
    UPDATE options SET value = 'Eb8af1/T57b89lCRuS97tPEl4CwxsAWAU7YNJ77oY+s=' WHERE name = 'passwordVerificationHash';
    UPDATE options SET value = 'QpC8XoiYYeqHPtHKRtbNxfTHsk+pEBqVBODYp0FkPBa22tlBBKBMigdLu5GNX8Uu' WHERE name = 'encryptedDataKey';
    ```
3.  After executing the changes, commit/write the changes. **This sets the password to** `**password**`**, allowing you to log in again.**
4.  Go to <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password_ → _Change password_ and replace the unsafe password.

## Handling protected notes

When the password is reset, the protected notes are permanently lost due to the fact that they are encrypted with your password so there is no way for Trilium to recover them.

For pre-existing protected notes (now unrecoverable), consider deleting them or exporting the unprotected notes. Then, delete `document.db` and start fresh.