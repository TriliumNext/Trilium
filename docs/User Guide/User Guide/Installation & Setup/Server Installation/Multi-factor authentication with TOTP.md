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
7.  Re-login will be required after TOTP setup is finished (After you refreshing the page).

## Recovery codes

Recovery codes can be used in place of the TOTP if you lose access to your authenticator. Trilium provides 8 different recovery codes, each recovery code can be used once.

To use a recovery code, simply login with your password and use the recovery code as the security token.

The initial set of recovery codes is generated when setting up your TOTP for the first time. They can be regenerated at any time by going to  <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_ and pressing the _Regenerate recovery codes_ button. This will generate a new set of recovery codes while at the same time disabling the previous ones.