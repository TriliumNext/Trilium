# Managing users
Administrators add, edit and remove the users of a server in <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Users_, which is listed under _Administration_. The page is not shown to users who aren't administrators, nor in the desktop application.

The users are listed in two groups, _Administrators_ and _Users_, each with their email address and the date they were added. A badge marks the account you are signed in with (_You_), the administrators (_Admin_, or _Primary admin_ for the account the server created), and anyone who hasn't chosen a password yet (_Setup pending_, or _Setup link expired_).

## Adding a user

1.  Select _Add user_.
2.  Enter a _Username_, and optionally an _Email_, which only administrators see.
3.  Turn on _Administrator_ under _Role_ to let the user see every note and manage users.
4.  Confirm. Trilium shows a setup link for the new user.
5.  Select _Copy link_ and send the link to the user, who uses it to choose their password. See <a class="reference-link" href="Signing%20in%20as%20a%20user.md">Signing in as a user</a>.

The setup link works once, for seven days, and is not shown again.

## Changing a user

Each user has a <span class="tn-icon bx bx-dots-vertical-rounded"></span> menu at the end of their row:

*   _Edit user..._ changes the username, the email address and the role. You can't change your own role, and the primary admin always keeps admin rights.
*   _Create new setup link..._ issues a new link and stops any earlier one from working:
    *   For a user who hasn't chosen a password, use it when the link expired or got lost.
    *   For a user who has a password, the link resets it, and the row shows _Reset pending_. Their current password keeps working until they use the link.
*   _Delete user..._ removes the user. Their notes are kept, and administrators still find them in the _Users_ note. You can't delete your own account, the primary admin, or the last administrator.

The primary admin has no setup link, since it signs in with the instance password. To change that password, see <a class="reference-link" href="../Authentication/Resetting%20your%20password.md">Resetting your password</a>.