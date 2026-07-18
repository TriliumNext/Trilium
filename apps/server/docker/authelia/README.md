# Authelia (for testing OpenID Connect / SSO login)

A throwaway [Authelia](https://www.authelia.com/) OIDC provider for testing Trilium's
OpenID Connect login locally — and for reproducing
[issue #6387](https://github.com/TriliumNext/Trilium/issues/6387) (Trilium not reading
`name`/`email` from the UserInfo endpoint when a spec-compliant provider keeps them out
of the ID token).

> **DEV ONLY.** Every secret in `config/` is a public throwaway. Never reuse this for anything real.

## Why a hosts entry is needed

Unlike a plain reverse proxy, OIDC shares one **issuer URL** between two callers: your
**browser** (which gets redirected to Authelia to log in) and the **Trilium server**
(which calls Authelia's token + userinfo endpoints over the back channel). Both must reach
Authelia at the same name. Authelia also refuses a bare `localhost` session-cookie domain
(it has no dot), so the portal runs on `auth.example.com`.

Add this line to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows,
`/etc/hosts` on Linux/macOS — needs admin):

```
127.0.0.1 auth.example.com
```

Trilium's own redirect target stays on `localhost:8080` (a loopback host, which is the only
way Authelia will accept an `http://` redirect URI), so no entry is needed for it.

Authelia 4.39 also **requires HTTPS** for its portal URL, so it's served with a self-signed
cert for `auth.example.com` (in `config/certs/`). Your browser will warn the first time —
click through. Trilium's back channel must trust it too; see step 2.

## Quick start

1. Start Authelia:
   ```bash
   docker compose up -d
   # tail logs to confirm it booted: docker compose logs -f authelia
   ```
   The portal is at **http://auth.example.com:9091** (login: `testuser` / `authelia`).

2. Start Trilium on the host (default port 8080) with these env vars set:
   ```bash
   TRILIUM_OAUTH_BASE_URL=http://localhost:8080
   TRILIUM_OAUTH_CLIENT_ID=trilium
   TRILIUM_OAUTH_CLIENT_SECRET=insecure_secret
   TRILIUM_OAUTH_ISSUER_BASE_URL=https://auth.example.com:9091
   TRILIUM_OAUTH_ISSUER_NAME=Authelia
   TRILIUM_OAUTH_ISSUER_ICON=https://auth.example.com:9091/favicon.ico
   # So Node trusts the self-signed Authelia cert on the back channel (token/userinfo calls):
   NODE_EXTRA_CA_CERTS=apps/server/docker/authelia/config/certs/public.crt
   ```
   For `pnpm run server:start`, export them first. PowerShell:
   ```powershell
   $env:TRILIUM_OAUTH_CLIENT_ID = 'trilium'
   $env:NODE_EXTRA_CA_CERTS = "$PWD\apps\server\docker\authelia\config\certs\public.crt"
   # ...etc
   ```
   (Quick-and-dirty alternative to `NODE_EXTRA_CA_CERTS`: `NODE_TLS_REJECT_UNAUTHORIZED=0` —
   disables TLS verification globally, dev only.)

3. In Trilium, open **Options → MFA**, choose **OpenID Connect** as the method, then enroll:
   the owner must already be signed in (password) before binding the SSO identity — see
   `afterCallback` in [apps/server/src/services/open_id.ts](../../src/services/open_id.ts).

4. Log out and sign in via the **Authelia** button. The browser bounces through
   `auth.example.com:9091` and back to `localhost:8080/callback`.

## Reproducing issue #6387 vs. the workaround

- **Reproduce the bug (default):** the shipped config has **no** `claims_policy`, so Authelia
  returns `name`/`email` only from the UserInfo endpoint. On `main`/released builds this throws
  `Cannot read properties of undefined (reading 'toString')`; on the `feature/oauth_improvements`
  branch it no longer crashes but enrolls with a **blank name/email** in settings.

- **Test the Authelia-side workaround:** in [config/configuration.yml](config/configuration.yml),
  uncomment the `claims_policy: 'trilium'` line on the client and the `claims_policies:` block,
  then `docker compose restart authelia`. Now `name`/`email` ride in the ID token and the fields
  populate. (You may need to clear cookies for `auth.example.com` between runs.)

## Cleanup

```bash
docker compose down -v
```

## Notes

- The argon2id password hash and all secrets (session/storage/HMAC, the inline OIDC JWKS
  key, and the self-signed TLS cert in `config/certs/`) are well-known Authelia dev samples /
  freshly generated throwaways — fine to commit, useless to an attacker.
- Regenerate the TLS cert with (run from this folder):
  ```bash
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout config/certs/private.key -out config/certs/public.crt \
    -days 3650 -subj "/CN=auth.example.com" \
    -addext "subjectAltName=DNS:auth.example.com"
  ```
  (Git Bash on Windows mangles `-subj`; prefix the command with `MSYS_NO_PATHCONV=1`.)
- Two harmless startup warnings are expected: the plaintext `client_secret` deprecation
  notice and "no access_control rules ... default_policy 'one_factor'".
