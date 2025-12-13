# Server Installation
Running Trilium on a server lets you access your notes from any device through a web browser and enables synchronization between multiple Trilium instances. This guide covers the different ways to install and configure Trilium on your server.

## Choose Your Installation Method

The easiest way to get started is with Docker, which works on most systems and architectures. If you prefer not to manage your own server, PikaPods offers managed hosting.

**Recommended approaches:**

*   [Docker Installation](1_Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md) - Works on AMD64 and ARM architectures
*   [PikaPods managed hosting](https://www.pikapods.com/pods?run=trilium-next) - No server management required
*   [Packaged Server Installation](1_Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.md) - Native Linux packages

**Advanced options:**

*   [Manual Installation](1_Server%20Installation/1.%20Installing%20the%20server/Manually.md) - Full control over the setup
*   [Kubernetes](1_Server%20Installation/1.%20Installing%20the%20server/Using%20Kubernetes.md) - For container orchestration
*   [NixOS Module](1_Server%20Installation/1.%20Installing%20the%20server/On%20NixOS.md) - Declarative configuration

All server installations include both desktop and mobile web interfaces.

## Configuration

Trilium stores its configuration in a `config.ini` file located in the [data directory](#root/dvbMBRXYMM2G). To customize your installation, copy the sample configuration file and modify it:

```sh
cp config-sample.ini config.ini
```

You can also use environment variables instead of the config file. This is particularly useful for Docker deployments. See the [configuration guide](#root/SneMubD5wTR6) for all available options.

### Changing the Data Directory

To store Trilium's data (database, config, backups) in a custom location, set the `TRILIUM_DATA_DIR` environment variable:

```sh
export TRILIUM_DATA_DIR=/path/to/your/trilium-data
```

### Upload Size Limits

By default, Trilium limits file uploads to 250MB. You can adjust this limit based on your needs:

```sh
# Increase limit to 450MB
export MAX_ALLOWED_FILE_SIZE_MB=450

# Remove limit entirely (use with caution)
export TRILIUM_NO_UPLOAD_LIMIT=true
```

### Disabling Authentication

See <a class="reference-link" href="1_Server%20Installation/Authentication.md">Authentication</a>.

## Reverse Proxy Setup

If you want to access Trilium through a domain name or alongside other web services, you'll need to configure a reverse proxy. Here's a basic nginx configuration:

```nginx
location /trilium/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}

# Allow larger file uploads (in server block)
client_max_body_size 0;  # 0 = unlimited
```

For Apache configuration, see the [Apache proxy setup](1_Server%20Installation/2.%20Reverse%20proxy/Apache.md) guide.