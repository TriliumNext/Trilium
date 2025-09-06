# On NixOS
This page describes configuring the Trilium module included in NixOS.

## Requirements

[NixOS](https://nixos.org/) installation.

## Configuration

Add this to your `configuration.nix`:

```
services.trilium-server.enable = true;

# default data directory: /var/lib/trilium
#services.trilium-server.dataDir = "/var/lib/trilium-sync-server";

# default bind address: 127.0.0.1, port 8080
#services.trilium-server.host = "0.0.0.0";
#services.trilium-server.port = 12783;
```

Uncomment any option you would like to change.

See the [NixOS options list](https://search.nixos.org/options?channel=unstable&from=0&size=50&sort=relevance&type=packages&query=trilium-server) for more options (including nginx reverse proxy configuration).