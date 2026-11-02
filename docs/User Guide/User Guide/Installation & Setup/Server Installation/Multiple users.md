# Multiple users
A Trilium server can be used by several people, each signing in with their own username and password, each with their own notes, and sharing notes with each other where they choose to.

> [!IMPORTANT]
> Support for multiple users is under development. Read [Limitations](#limitations) before adding anyone to a server that holds notes you care about.

> [!WARNING]
> Every user can still reach features that affect the whole server, such as [scripts](../../Scripting.md), the SQL console, backups and most of the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>. Only add people you would trust with the server itself.

Multiple users are available on a server installation only. The desktop application and the in-browser version have a single user.

## Users and roles

*   The **primary admin** is the account the server creates on its own, named `admin`. It signs in with the instance password, together with the [second factor](Multi-factor%20authentication%20with%20TOTP.md) or [OpenID Connect](Signing%20in%20with%20OpenID%20Connect.md) if those are set up. It can't be deleted or lose its admin rights.
*   An **administrator** sees every note on the server and manages the users.
*   A **user** sees their own notes and the notes others have given them access to.

A server that has never had a second user behaves as before: the login screen asks for the password alone, and the note tree is unchanged. To add users, see <a class="reference-link" href="Multiple%20users/Managing%20users.md">Managing users</a>; for what they do next, see <a class="reference-link" href="Multiple%20users/Signing%20in%20as%20a%20user.md">Signing in as a user</a>.

## How the notes are organized

The <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> of a user starts with two entries:

*   _My notes_ holds the user's own notes. A note created at the top of the tree goes in here, and notes can't be moved or cloned next to it.
*   _Shared with me_ lists the notes others have given the user access to, as long as the user can't reach them otherwise. It appears only when there is something in it. See <a class="reference-link" href="Multiple%20users/Giving%20access%20to%20notes.md">Giving access to notes</a>.

For administrators, the tree keeps its usual shape. Every user's _My notes_ is in a _Users_ note at the top of the tree, under the user's name. The primary admin's own notes stay directly in the tree, as on a single-user server.

## Limitations

*   _Can view_ doesn't prevent editing yet: anyone with access to a note can change it.
*   The <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>, the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>, saved searches and AI chats are shared by all users.
*   On a note shared with them, a user doesn't get the labels the owner set on the notes above it, such as an icon or a sort order, nor the definitions from a template they can't see.
*   Changes made by one user don't always show for others right away.
*   Only the primary admin can use a second factor or [OpenID Connect](Signing%20in%20with%20OpenID%20Connect.md).
*   [Synchronization](../Synchronization.md) is not aware of users: a desktop application or another server synchronizing with this one receives every user's notes.

To keep the notes of several people fully apart, run <a class="reference-link" href="1.%20Installing%20the%20server/Multiple%20server%20instances.md">Multiple server instances</a> instead.