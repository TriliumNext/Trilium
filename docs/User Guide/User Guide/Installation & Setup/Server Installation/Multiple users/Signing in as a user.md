# Signing in as a user
A new user signs in to Trilium for the first time through the setup link an administrator gives them (see <a class="reference-link" href="Managing%20users.md">Managing users</a>), which lets them choose their password.

## Choosing a password

1.  Open the setup link. The page greets you by your username.
2.  Enter your password twice and select _Set password_.
3.  Select _Go to sign in_ and sign in with your username and the new password.

A setup link works only once and only until the date shown on the page. If it reports that the link doesn't work, ask an administrator for a new one.

## Signing in

Once anyone besides the primary admin has a password, the login screen asks for a _Username_ along with the _Password_:

*   Users enter their own username and password.
*   The primary admin enters its username (`admin`, unless an administrator renamed it) and the instance password. The one-time password of the [second factor](../Multi-factor%20authentication%20with%20TOTP.md) applies to the primary admin only.

To change a forgotten password, ask an administrator for a new setup link. Your current password keeps working until you use it.

## Signing out

The <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> shows the account you are signed in with at the top, with its role. To sign out, select the <span class="tn-icon bx bx-log-out"></span> button beside it.