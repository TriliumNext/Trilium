# Server Installation
This guide outlines the steps to install Trilium on your own server. You might consider this option if you want to set up [synchronization](Synchronization.md) or use Trilium in a browser - accessible from anywhere.

## Installation Options

There are several ways to install Trilium on a server, each with its own advantages:

*   **Recommended**: [Docker Installation](Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md) - Available for **AMD64** and **ARM** architectures.
*   [Packaged Server Installation](Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.md)
*   [PikaPods managed hosting](https://www.pikapods.com/pods?run=trilium-next)
*   [Manual Installation](Server%20Installation/1.%20Installing%20the%20server/Manually.md)
*   [Kubernetes](Server%20Installation/1.%20Installing%20the%20server/Using%20Kubernetes.md)
*   [Cloudron](https://www.cloudron.io/store/com.github.trilium.cloudronapp.html)
*   [HomelabOS](https://homelabos.com/docs/software/trilium/)
*   [NixOS Module](Server%20Installation/1.%20Installing%20the%20server/On%20NixOS.md)

The server installation includes both web and [mobile frontends](Mobile%20Frontend.md).

## Configuration

After setting up your server installation, you may want to configure settings such as the port or enable [TLS](Server%20Installation/HTTPS%20\(TLS\).md). Configuration is managed via the Trilium `config.ini` file, which is located in the [data directory](Data%20directory.md) by default. To begin customizing your setup, copy the provided `config-sample.ini` file with default values to `config.ini`.

You can also review the [configuration](../Advanced%20Usage/Configuration%20\(config.ini%20or%20e.md) file to provide all `config.ini` values as environment variables instead.

### Config Location

By default, `config.ini`, the [database](../Advanced%20Usage/Database.md), and other important Trilium data files are stored in the [data directory](Data%20directory.md). If you prefer a different location, you can change it by setting the `TRILIUM_DATA_DIR` environment variable:

```
export TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data
```

### Disabling / Modifying the Upload Limit

If you're running into the 250MB limit imposed on the server by default, and you'd like to increase the upload limit, you can set the `TRILIUM_NO_UPLOAD_LIMIT` environment variable to `true` disable it completely:

```
export TRILIUM_NO_UPLOAD_LIMIT=true 
```

Or, if you'd simply like to _increase_ the upload limit size to something beyond 250MB, you can set the `MAX_ALLOWED_FILE_SIZE_MB` environment variable to something larger than the integer `250` (e.g. `450` in the following example):

```
export MAX_ALLOWED_FILE_SIZE_MB=450
```

### Disabling Authentication

See <a class="reference-link" href="Server%20Installation/Authentication.md">Authentication</a>.

## Reverse Proxy Setup

To configure a reverse proxy for Trilium, you can use either **nginx** or **Apache**. You can also check out the documentation stored in the Reverse proxy folder.

### nginx

Add the following configuration to your `nginx` setup to proxy requests to Trilium:

```
location /trilium/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

To avoid limiting the size of payloads, include this in the `server {}` block:

```
# Set to 0 for unlimited. Default is 1M.
client_max_body_size 0;
```

### Apache

For an Apache setup, refer to the [Apache proxy setup](Server%20Installation/2.%20Reverse%20proxy/Apache%20using%20Docker.md) guide.