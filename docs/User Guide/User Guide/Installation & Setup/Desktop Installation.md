# Desktop Installation
To install Trilium on your desktop, follow these steps:

1.  **Download the Latest Release**: Obtain the appropriate binary release for your operating system from the [latest release page](https://github.com/TriliumNext/Trilium/releases/latest) on GitHub.
2.  **Extract the Package**: Unzip the downloaded package to a location of your choice.
3.  **Run the Application**: Launch Trilium by executing the `trilium` executable found within the unzipped folder.

## Startup Scripts

Trilium offers various startup scripts to customize your experience:

*   `trilium-no-cert-check`: Starts Trilium without validating [TLS certificates](Server%20Installation/HTTPS%20\(TLS\).md), useful if connecting to a server with a self-signed certificate.
    *   Alternatively, set the `NODE_TLS_REJECT_UNAUTHORIZED=0` environment variable before starting Trilium.
*   `trilium-portable`: Launches Trilium in portable mode, where the [data directory](Data%20directory.md) is created within the application's directory, making it easy to move the entire setup.
*   `trilium-safe-mode`: Boots Trilium in "safe mode," disabling any startup scripts that might cause the application to crash.

## Synchronization

For Trilium desktop users who wish to synchronize their data with a server instance, refer to the <a class="reference-link" href="Synchronization.md">Synchronization</a> guide for detailed instructions.