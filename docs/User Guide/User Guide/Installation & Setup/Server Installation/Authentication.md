# Authentication
## Disabling authentication

If you are running Trilium on `localhost` only or if authentication is handled by another component, you can disable Trilium’s authentication by adding the following to `config.ini`:

```
[General]
noAuthentication=true
```

Disabling authentication will bypass even the <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-Factor Authentication</a> since v0.94.1.

## Brute-force protection

Trilium limits each IP address to 10 failed sign-in attempts in 15 minutes. Once an address reaches the limit, Trilium rejects every further attempt from it, including correct ones, until the 15 minutes have passed. The sign-in page then shows _Too many login attempts_; other clients receive HTTP status 429.

The limit applies to every way of signing in with the password:

*   The sign-in page.
*   Setting up <a class="reference-link" href="../Synchronization.md">Synchronization</a> from a desktop or mobile app.
*   Connecting the <a class="reference-link" href="../Web%20Clipper.md">Web Clipper</a> or the Android sender app.
*   Requesting a token through <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a>.

All of these count toward the same limit, and a wrong password, a wrong one-time password and a wrong recovery code each count as one failed attempt. Successful sign-ins are not counted.

The limit is per IP address, not per account, so an attacker cannot lock you out by failing to sign in from their own address. The count is kept in memory: restarting the server clears it.

> [!IMPORTANT]
> Behind a reverse proxy, Trilium sees every request as coming from the proxy unless it is configured as a <a class="reference-link" href="2.%20Reverse%20proxy/Trusted%20proxy.md">Trusted proxy</a>. All clients then share a single limit, so a few wrong attempts from anyone block everyone.

### Blocking repeated failures with fail2ban

A failed attempt on the sign-in page is answered with HTTP status 401 and recorded in the <a class="reference-link" href="../../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md">Backend (server) logs</a> as:

```
WARNING: Wrong password from 203.0.113.7, rejecting.
```

When <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-Factor Authentication</a> is enabled, a wrong one-time password or recovery code is logged as `Wrong totp` instead. Tools such as fail2ban can match either the log line or the 401 responses to `POST /login` in the reverse proxy's access log to block an address for longer than 15 minutes.

## Understanding how the session works

Once logged into Trilium, the application will store this information about the login into a cookie on the browser, but also as a session on the server.

If “Remember me” is checked, then the login will expire in 21 days. This period can be adjusted by modifying the `Session.cookieMaxAge` value in `config.ini`. For example, to have the session expire in one day:

```
[Session]
cookieMaxAge=86400
```

When “Remember me” is unchecked, the behavior is different. At client/browser level the authentication does not have any expiration date, but it will be automatically cleared as soon as the user closes the browser. Nevertheless, the server will also dismiss this authentication in around 24 hours from the _last interaction with the application_.

Changing or resetting the password logs out every session, including the one that made the change, so you have to log in again with the new password. This also applies when the password is changed on another instance and reaches the server through synchronization. If you suspect that someone has obtained your session cookie, changing the password cuts off their access.

## Viewing active sessions

The login sessions are now stored in the same <a class="reference-link" href="../../Advanced%20Usage/Database.md">Database</a> as the user data. In order to view which sessions are active, open the <a class="reference-link" href="../../Advanced%20Usage/Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a> and run the following query:

```
SELECT * FROM sessions
```

Expired sessions are periodically cleaned by the server, generally an hourly interval.

## See also

*   <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-Factor Authentication</a>
*   <a class="reference-link" href="2.%20Reverse%20proxy/Trusted%20proxy.md">Trusted proxy</a>