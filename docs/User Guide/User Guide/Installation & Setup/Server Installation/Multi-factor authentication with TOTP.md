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
7.  Re-login will be required after TOTP setup is finished (after refreshing the page).

## Signing in

Once TOTP is enabled, the sign-in page asks for the code from your authenticator app in _One-time password or recovery code_, below the password.

Trilium accepts the code for the current 30-second period as well as the periods just before and after it, so a clock that is slightly off on either side still works. Since v0.106.0, each code is accepted only once: after a successful sign-in, that code and any older one are rejected, even while they are still valid.

A wrong one-time password counts toward the same limit of failed attempts as a wrong password. See _Brute-force protection_ in <a class="reference-link" href="Authentication.md">Authentication</a>.

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

The initial set of recovery codes is generated when setting up your TOTP for the first time. They can be regenerated at any time by going to  <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_ and pressing the _Regenerate recovery codes_ button. This will generate a new set of recovery codes while at the same time disabling the previous ones.