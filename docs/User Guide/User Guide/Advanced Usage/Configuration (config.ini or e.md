# Configuration (config.ini or environment variables)
Trilium supports configuration via a file named `config.ini` and environment variables. This document provides a comprehensive reference for all configuration options.

## Location of the configuration file

The configuration file is not located in the same directory as the application. Instead, the `config.ini` is located in the <a class="reference-link" href="../Installation%20%26%20Setup/Data%20directory.md">Data directory</a>. As such, the configuration file is only available after starting the application and creating a database.

## Configuration Precedence

Configuration values are loaded in the following order of precedence (highest to lowest):

1.  **Environment variables** (checked first)
2.  **config.ini file values**
3.  **Default values**

## Environment Variable Patterns

Trilium supports multiple environment variable patterns for flexibility. The primary pattern is: `TRILIUM_[SECTION]_[KEY]`

Where:

*   `SECTION` is the INI section name in UPPERCASE
*   `KEY` is the camelCase configuration key converted to UPPERCASE (e.g., `instanceName` → `INSTANCENAME`)

Additionally, shorter aliases are available for common configurations (see Alternative Variables section below).

## Environment Variable Reference

### General Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_GENERAL_INSTANCENAME` | string | ""  | Instance name for API identification |
| `TRILIUM_GENERAL_NOAUTHENTICATION` | boolean | false | Disable authentication (server only) |
| `TRILIUM_GENERAL_NOBACKUP` | boolean | false | Disable automatic backups |
| `TRILIUM_GENERAL_NODESKTOPICON` | boolean | false | Disable desktop icon creation |
| `TRILIUM_GENERAL_READONLY` | boolean | false | Enable read-only mode |

### Network Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_NETWORK_HOST` | string | "0.0.0.0" | Server host binding |
| `TRILIUM_NETWORK_PORT` | string | "3000" | Server port |
| `TRILIUM_NETWORK_HTTPS` | boolean | false | Enable HTTPS |
| `TRILIUM_NETWORK_CERTPATH` | string | ""  | SSL certificate path |
| `TRILIUM_NETWORK_KEYPATH` | string | ""  | SSL key path |
| `TRILIUM_NETWORK_TRUSTEDREVERSEPROXY` | boolean/string | false | Reverse proxy trust settings |
| `TRILIUM_NETWORK_CORSALLOWORIGIN` | string | ""  | CORS allowed origins |
| `TRILIUM_NETWORK_CORSALLOWMETHODS` | string | ""  | CORS allowed methods |
| `TRILIUM_NETWORK_CORSALLOWHEADERS` | string | ""  | CORS allowed headers |
| `TRILIUM_NETWORK_CORSRESOURCEPOLICY` | string | same-origin | CORS Resource Policy allows same-origin/same-site/cross-origin as values, will error if not |

### Session Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_SESSION_COOKIEMAXAGE` | integer | 1814400 | Session cookie max age in seconds (21 days) |

### Sync Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_SYNC_SYNCSERVERHOST` | string | ""  | Sync server host URL |
| `TRILIUM_SYNC_SYNCSERVERTIMEOUT` | string | "120000" | Sync server timeout in milliseconds |
| `TRILIUM_SYNC_SYNCPROXY` | string | ""  | Sync proxy URL |

### MultiFactorAuthentication Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL` | string | ""  | OAuth/OpenID base URL |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID` | string | ""  | OAuth client ID |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET` | string | ""  | OAuth client secret |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL` | string | "[https://accounts.google.com](https://accounts.google.com)" | OAuth issuer base URL |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME` | string | "Google" | OAuth issuer display name |
| `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON` | string | ""  | OAuth issuer icon URL |

### Logging Section

| Environment Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TRILIUM_LOGGING_RETENTIONDAYS` | integer | 90  | Number of days to retain log files |

## Alternative Environment Variables

The following alternative environment variable names are also supported and work identically to their longer counterparts:

### Network CORS Variables

*   `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` (alternative to `TRILIUM_NETWORK_CORSALLOWORIGIN`)
*   `TRILIUM_NETWORK_CORS_ALLOW_METHODS` (alternative to `TRILIUM_NETWORK_CORSALLOWMETHODS`)
*   `TRILIUM_NETWORK_CORS_ALLOW_HEADERS` (alternative to `TRILIUM_NETWORK_CORSALLOWHEADERS`)
*   `TRILIUM_NETWORK_CORS_RESOURCE_POLICY` (alternative to `TRILIUM_NETWORK_CORSRESOURCEPOLICY`)

### Sync Variables

*   `TRILIUM_SYNC_SERVER_HOST` (alternative to `TRILIUM_SYNC_SYNCSERVERHOST`)
*   `TRILIUM_SYNC_SERVER_TIMEOUT` (alternative to `TRILIUM_SYNC_SYNCSERVERTIMEOUT`)
*   `TRILIUM_SYNC_SERVER_PROXY` (alternative to `TRILIUM_SYNC_SYNCPROXY`)

### OAuth/MFA Variables

*   `TRILIUM_OAUTH_BASE_URL` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL`)
*   `TRILIUM_OAUTH_CLIENT_ID` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID`)
*   `TRILIUM_OAUTH_CLIENT_SECRET` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET`)
*   `TRILIUM_OAUTH_ISSUER_BASE_URL` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL`)
*   `TRILIUM_OAUTH_ISSUER_NAME` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME`)
*   `TRILIUM_OAUTH_ISSUER_ICON` (alternative to `TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON`)

### Logging Variables

*   `TRILIUM_LOGGING_RETENTION_DAYS` (alternative to `TRILIUM_LOGGING_RETENTIONDAYS`)

## Boolean Values

Boolean environment variables accept the following values:

*   **True**: `"true"`, `"1"`, `1`
*   **False**: `"false"`, `"0"`, `0`
*   Any other value defaults to `false`

## Using Environment Variables

Both naming patterns are fully supported and can be used interchangeably:

*   The longer format follows the section/key pattern for consistency with the INI file structure
*   The shorter alternatives provide convenience for common configurations
*   You can use whichever format you prefer - both are equally valid

## Examples

### Docker Compose Example

```yaml
services:
  trilium:
    image: triliumnext/trilium
    environment:
      # Using full format
      TRILIUM_GENERAL_INSTANCENAME: "My Trilium Instance"
      TRILIUM_NETWORK_PORT: "8080"
      TRILIUM_NETWORK_CORSALLOWORIGIN: "https://myapp.com"
      TRILIUM_SYNC_SYNCSERVERHOST: "https://sync.example.com"
      TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL: "https://auth.example.com"
      
      # Or using shorter alternatives (equally valid)
      # TRILIUM_NETWORK_CORS_ALLOW_ORIGIN: "https://myapp.com"
      # TRILIUM_SYNC_SERVER_HOST: "https://sync.example.com"
      # TRILIUM_OAUTH_BASE_URL: "https://auth.example.com"
```

### Shell Export Example

```
# Using either format
export TRILIUM_GENERAL_NOAUTHENTICATION=false
export TRILIUM_NETWORK_HTTPS=true
export TRILIUM_NETWORK_CERTPATH=/path/to/cert.pem
export TRILIUM_NETWORK_KEYPATH=/path/to/key.pem
export TRILIUM_LOGGING_RETENTIONDAYS=30

# Start Trilium
npm start
```

## config.ini Reference

For the complete list of configuration options and their INI file format, please review the [config-sample.ini](https://github.com/TriliumNext/Trilium/blob/main/apps/server/src/assets/config-sample.ini) file in the Trilium repository