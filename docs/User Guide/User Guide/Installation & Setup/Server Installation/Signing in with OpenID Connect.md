# Signing in with OpenID Connect
OpenID is a standardized way to let you log into websites using an account from another service, like Google or Authelia, to verify your identity.

When OpenID is activated, the password-based authentication in Trilium is replaced with a button that connects using your provider. This means that the configuration of <a class="reference-link" href="Multi-factor%20authentication%20with%20TOTP.md">Multi-factor authentication with TOTP</a> no longer takes effect, since your provider has to handle any multi-factor authentication.

## Setup

Setting up authentication with OpenID connect is a two-step process:

1.  First the Trilium server must be configured with information about your authentication provider such as the URL, client ID and secret.
2.  Second, the user must connect from options to create a link between the account on the provider and the one Trilium has.

### Configuring the authentication provider

1.  First, make sure the authentication provider (e.g. Google, Authelia) is configured properly.
    
    1.  The redirect URL of Trilium is `https://<your-trilium-domain>/callback`.
    2.  You should obtain the base URL, client ID and client secret.
2.  Set the following information using <a class="reference-link" href="../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md">Configuration (config.ini or environment variables)</a>:
    
    | Configuration | `config.ini` in `[MultiFactorAuthentication]` section | Environment variable | Description |
    | --- | --- | --- | --- |
    | Base URL\* | `oauthBaseUrl` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL` | The URL of your Trilium instance (e.g. `https://example.com`). |
    | Client ID\* | `oauthClientId` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID` | The client ID from your provider configuration. |
    | Client Secret\* | `oauthClientSecret` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET` | The client secret from your provider configuration. |
    
    Asterisk (\*) marks a required field
3.  The default OAuth issuer is Google. To use other services such as Authentik or Auth0, you can configure the settings via `oauthIssuerBaseUrl`, `oauthIssuerName`, and `oauthIssuerIcon` in the `config.ini` file. Alternatively, these values can be set using environment variables:
    
    | Configuration | `config.ini` in `[MultiFactorAuthentication]` section | Environment variable | Description |
    | --- | --- | --- | --- |
    | Issuer base URL | `oauthIssuerBaseUrl` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL` | The URL of your provider (e.g. `https://auth.example.com:9091`) |
    | Issuer name | `oauthIssuerName` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME` | The name of your authentication provider, used for reference on the login screen and in settings. Default is “Google”. |
    | Issuer icon | `oauthIssuerIcon` | `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON` | Optionally, the URL to a logo of the provider. By default it will try to obtain the favicon from the website, so it's optional. |
    
    All the fields here are optional, since the default OAuth issuer is Google.
4.  Restart the server so that the changes are applied.

> [!NOTE]
> Legacy environment variables are also supported: `TRILIUM_OAUTH_BASE_URL`, `TRILIUM_OAUTH_CLIENT_ID`, `TRILIUM_OAUTH_CLIENT_SECRET`, and for customizing the provider: `TRILIUM_OAUTH_ISSUER_BASE_URL`, `TRILIUM_OAUTH_ISSUER_NAME`, `TRILIUM_OAUTH_ISSUER_ICON`

## Connecting to the authentication provider

Once the server has been configured at the previous step, the next step is to create a link between your account on the authentication provider and the Trilium instance. This makes sure that only you can access the Trilium instance, and not just any other valid account.

To do so:

1.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth._
2.  In the _Sign-in with_ field, choose _OpenID Connect provider._
3.  In the _OpenID Connect_ section, look for the _Connect account_ button.
4.  This will redirect you to your authentication provider, where you can sign in or confirm the action if needed.
5.  Once you are authenticated you will be redirected back to the Trilium application.

## Logging out

When logging out of Trilium, a request is made to the authentication provider to log out from there as well. This feature depends on the authentication provider, so it may not be honored (Google and Authelia are known cases in which they don't respect the logout feature).

## Switching providers

When switching providers (e.g. going from Google to Authelia), it's important to take the following steps:

1.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Password & Auth_.
2.  In the _OpenID Connect_ section, press the _Disconnect_ button.
3.  Wait for the section to indicate that you are disconnected.
4.  Change the configuration pointing to the new provider.
5.  Restart your server.
6.  Repeat the normal steps to connect to the authentication provider.

Failing to disconnect before switching providers might temporarily lock you in, as you will not be able to login (credentials won't match). Should this happen:

1.  Modify the server configuration again to your old provider.
2.  Restart the server and follow the disconnect instructions above.
3.  Modify the server configuration again to your new provider.
4.  Restart again the server.

## Deactivating OpenID Connect temporarily

To disable the OpenID Connect authentication and instead rely on the local password temporarily, you must:

1.  Modify the `config.ini` or environment variables (depending on how you set up the provider information) and temporarily deactivate the multi-factor authentication section by renaming `[MultiFactorAuthentication]` to something else (e.g. `[MultiFactorAuthentication.bak]`.
2.  Restart the server for the changes to take effect.

## Troubleshooting

### Setup fails with “invalid user”

If you are running behind a [reverse proxy](2.%20Reverse%20proxy.md), a buffer overflow can cause this issue. Here is a sample fix for <a class="reference-link" href="2.%20Reverse%20proxy/Nginx.md">Nginx</a>: 

```
proxy_buffer_size 128k;
proxy_buffers 4 256k;
proxy_busy_buffers_size 256k;
```