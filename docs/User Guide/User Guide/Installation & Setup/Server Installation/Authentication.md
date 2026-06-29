# Authentication
## Disabling authentication

If you are running Trilium on `localhost` only or if authentication is handled by another component, you can disable Trilium’s authentication by adding the following to `config.ini`:

```
[General]
noAuthentication=true
```

Disabling authentication will bypass even the <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-Factor Authentication</a> since v0.94.1.

## Understanding how the session works

Once logged into Trilium, the application will store this information about the login into a cookie on the browser, but also as a session on the server.

If “Remember me” is checked, then the login will expire in 21 days. This period can be adjusted by modifying the `Session.cookieMaxAge` value in `config.ini`. For example, to have the session expire in one day:

```
[Session]
cookieMaxAge=86400
```

When “Remember me” is unchecked, the behavior is different. At client/browser level the authentication does not have any expiration date, but it will be automatically cleared as soon as the user closes the browser. Nevertheless, the server will also dismiss this authentication in around 24 hours from the _last interaction with the application_.

## Viewing active sessions

The login sessions are now stored in the same <a class="reference-link" href="../../Advanced%20Usage/Database.md">Database</a> as the user data. In order to view which sessions are active, open the <a class="reference-link" href="../../Advanced%20Usage/Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a> and run the following query:

```
SELECT * FROM sessions
```

Expired sessions are periodically cleaned by the server, generally an hourly interval.

## See also

*   <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-Factor Authentication</a>