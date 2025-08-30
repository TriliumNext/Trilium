# Multiple server instances
Trilium does not support multiple users. In order to have two or more persons with their own set of notes, multiple server instances must be set up. It is also not possible to use multiple [sync](#root/KFhm9yCthQOh) servers.

To allow multiple server instances on a single physical server:

*   For <a class="reference-link" href="Packaged%20version%20for%20Linux.md">Packaged version for Linux</a> or <a class="reference-link" href="Manually.md">Manually</a>, if starting the server manually just specify a different port and data directory per instance:
    
    ```
    TRILIUM_NETWORK_PORT=8080 TRILIUM_DATA_DIR=/path/to/your/data-dir-A /opt/trilium/trilium.sh
    ```
    
    For a second instance:
    
    ```
    TRILIUM_NETWORK_PORT=8081 TRILIUM_DATA_DIR=/path/to/your/data-dir-B /opt/trilium/trilium.sh
    ```
    
    If using `systemd`, then set the [environment variables in the service configuration](https://serverfault.com/questions/413397/how-to-set-environment-variable-in-systemd-service).
*   For <a class="reference-link" href="Using%20Docker.md">Using Docker</a>, simply use two different containers, each with their own port binding and data directory.
*   For <a class="reference-link" href="On%20NixOS.md">On NixOS</a>, the only possible way is to use Docker OCI containers or at least one NixOS container with its own service definition.

For support or additional context, see the related [GitHub Discussion](https://github.com/orgs/TriliumNext/discussions/1642#discussioncomment-12768808).