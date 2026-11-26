# Multi-factor authentication with TOTP
Multi-factor authentication (MFA) is a security process that requires users to provide two or more verification factors to gain access to a system, application, or account. This adds an extra layer of protection beyond just using a password.

By requiring more than one verification method, MFA helps reduce the risk of unauthorized access, even if someone has obtained your password. It’s highly recommended for securing sensitive information stored in your notes.

## Relationship to OpenID Connect (OIDC)

Multi-factor authentication makes your Trilium login safer by requiring an additional proof of identity apart from your password. <a class="reference-link" href="Signing%20in%20with%20OpenID%20Connect.md">Signing in with OpenID Connect</a> is a different concept which delegates your authentication to an external provider (e.g. your Google provider, or a self-hosted one such as Authelia). These authentication providers might provide their own security features such as TOTP or passkeys.

## Time-based one-time password (TOTP)

TOTP (Time-Based One-Time Password) is a security feature that generates a unique, temporary code on your device, like a smartphone, which changes every 30 seconds. You use this code, along with your password, to log into your account, making it much harder for anyone else to access them.

1.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth._
2.  Make sure _Sign-in with_ has _Local password_ selected.
3.  In the _Two-factor authentication_ section, press _Set up._
4.  Scan the QR code or manually enter the code in your authenticator app.
5.  Enter the verification code from your authenticator app to confirm that the setup was successful and press _Verify & continue_.
6.  Save the recovery codes, then tick the confirmation and press _Finish setup_.
7.  Enter your password and press _Confirm_.
8.  Re-login will be required after TOTP setup is finished (after refreshing the page).

## Changing the second factor

Removing TOTP, regenerating the recovery codes, setting TOTP up and changing _Sign-in with_ each ask for your password and, while TOTP is on, a one-time password or a recovery code. Without them, neither a script running in the page nor anyone who gets hold of a logged-in session can switch the second factor off.

## Signing in

Once TOTP is enabled, the sign-in page asks for the code from your authenticator app in _One-time password or recovery code_, below the password.

Trilium accepts the code for the current 30-second period as well as the periods just before and after it, so a clock that is slightly off on either side still works. Since v0.106.0, each code is accepted only once: after a successful sign-in, that code and any older one are rejected, even while they are still valid.

A wrong one-time password counts toward the same limit of failed attempts as a wrong password. See _Brute-force protection_ in <a class="reference-link" href="Authentication.md">Authentication</a>.

### Waiting after wrong codes

Trilium also counts wrong one-time passwords for the whole server, whatever address they come from. After five wrong codes in a row, the server refuses every one-time password for a minute, and twice as long after each further wrong code, up to an hour. The sign-in page says when codes are accepted again. A recovery code is still accepted during the wait.

The count starts over after a day without a wrong code. Restarting the server does not clear it.

If the server's clock ran ahead when a code was last accepted, the server refuses every code until its clock catches up, for at most a day. The sign-in page says until when.

## Connecting a device to the server

Once TOTP is enabled, connecting a new desktop or mobile app to the server through <a class="reference-link" href="../Synchronization.md">Synchronization</a> also asks for the second factor. On the _Connect to an existing server_ screen, enter a one-time password or a recovery code in _One-time password or recovery code_, below the server's password. Without it, the server refuses to set up the sync.

The second factor is only asked for when a device is first connected. A device that is already set up keeps syncing without it.

> [!NOTE]
> Versions prior to v0.107.0 do not ask for the second factor when setting up the sync. Update the desktop and mobile apps along with the server, since older apps have no field to send it.

## Obtaining an ETAPI token with a password

Once TOTP is enabled, obtaining a token for the <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> through the `/auth/login` call also requires the second factor: send the one-time password or a recovery code as `totpToken`, next to `password`. Each code is accepted only once.

For scripts and tools that run unattended, create a token in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _ETAPI_ instead. Such a token works regardless of TOTP.

> [!WARNING]
> Versions prior to v0.107.0 issue an ETAPI token for the password alone, even with TOTP enabled.

## Recovery codes

Recovery codes can be used in place of the TOTP if you lose access to your authenticator. Trilium provides 8 different recovery codes, each recovery code can be used once.

To use a recovery code, simply login with your password and use the recovery code as the security token.

The initial set of recovery codes is generated when setting up your TOTP for the first time. They can be regenerated at any time by going to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_ and pressing the _Regenerate recovery codes_ button, which asks for your password and a one-time password. This will generate a new set of recovery codes while at the same time disabling the previous ones.

## The key file

Trilium encrypts the TOTP secret and the recovery codes with a key kept in `second_factor_key.txt` in the <a class="reference-link" href="../Data%20directory.md">Data directory</a>, outside the database. Backups, anonymized databases and synced devices hold the encrypted secret, but not the key.

The file belongs to the second factor. When you move the data directory or restore the server on another machine, copy `second_factor_key.txt` along with `document.db`. Without it, the server cannot check one-time passwords and refuses every sign-in until the second factor is removed, as described below.

## After upgrading

Earlier versions stored the TOTP secret and the recovery codes in the database, next to the key that opens them. The upgrade encrypts them with the key file, but every backup made before it still holds a working second factor. Until TOTP is set up again, _Security records of this device_ (below) says so, and downloading a backup or an anonymized database asks for your password and a one-time password.

To make those copies worthless, set TOTP up again after the upgrade, before you download a backup:

1.  Restart the server in <a class="reference-link" href="../../Advanced%20Usage/Safe%20mode.md">Safe mode</a>, so that no script runs in the page while you do this.
2.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_, remove TOTP, then set it up again. This replaces the recovery codes too.
3.  Restart the server normally.

Before the upgrade, a sync peer could also change the settings that each device keeps for itself. The upgrade puts back the changes it can recognize and lists them under _Settings repaired at startup_, but it cannot tell every change from one of your own. While in Safe mode, also compare these settings with your own setup, on every device: the sign-in method and the second factor, the backups and their folder, the sync server and the proxy.

## Removing a second factor that cannot be used

The server cannot check one-time passwords when `second_factor_key.txt` is missing, or when a sync peer wrote one of the settings of the second factor, which _Security records of this device_ reports. It then refuses every sign-in, recovery codes included. To remove such a factor, or one whose authenticator and recovery codes are both lost:

1.  Stop the server.
2.  If the factor still works but you lost its codes, delete `second_factor_key.txt` from the data directory.
3.  Start the server with the `TRILIUM_RESET_SECOND_FACTOR` environment variable set to words of your own, at least 16 characters long.
4.  Sign in with your password, and enter these words as the one-time password.
5.  Set up TOTP again, then restart the server without the variable.

Until TOTP is set up again, every start needs the variable: without it, the server refuses every sign-in. The log says when the variable is set but never shows its value, and the server removes the variable from its environment, so the programs it starts do not inherit it.

## Security records

_Security records of this device_, at the bottom of <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_, lists what the server recorded about sign-ins:

*   The state of the second factor: set up with an earlier version, blocked because a sync peer wrote one of its settings, or removed with `TRILIUM_RESET_SECOND_FACTOR`.
*   The wait after wrong one-time passwords, while it lasts.
*   _Right password, wrong or missing code_: sign-ins with the right password but without a right code. Whoever made them knows your password. If it wasn't you, change the password and set up TOTP again.
*   _Settings repaired at startup_: settings of the device that a sync peer had changed and that a start put back.

No button clears these records. Each list is emptied 90 days after its last entry.

## What the second factor protects against

The password syncs between devices, so whoever holds a copy of the database of any of your devices can set a password of their own and sign in with it. With TOTP on the server, they still need the second factor: it does not sync, no copy of a database holds its key, changing it asks for a current code, and the server takes only a few dozen wrong codes a day.

TOTP cannot protect you from a script that runs in your page while you type a code, for example one that shows a false prompt for a one-time password. Keep scripts you did not write out of your notes, and enter codes only for the actions described above.

With <a class="reference-link" href="Signing%20in%20with%20OpenID%20Connect.md">Signing in with OpenID Connect</a> as the sign-in method, changing the sign-in method asks for the password alone. A sync peer that set a password of its own can therefore switch back to the password sign-in through a script that runs in your page.

On a server without a second factor, a copy of the database of any synced device is enough to sign in as you.