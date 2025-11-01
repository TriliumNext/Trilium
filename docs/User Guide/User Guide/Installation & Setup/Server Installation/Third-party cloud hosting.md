# Third-party cloud hosting
As an alternative to [hosting your own Trilium instance](1.%20Installing%20the%20server), there are two services out there that provide out of the box support for Trilium.

> [!IMPORTANT]
> **Disclaimer**: The Trilium Notes project and maintainers are not directly affiliated with either of the projects.
> 
> PikaPods have gracefully offered us free credits for testing purposes.

## Cloud instance providers

### PikaPods

1.  Go to [pikapods.com](https://www.pikapods.com)  and sign up.
2.  In the “Available Apps” section, look for "TriliumNext  
     and select “Run your own”.
3.  Follow the on-screen instructions to set up your own cloud hosted instance.

PikaPods generally updates their Trilium instances to the latest version within a two-week interval after a new version is released.

### trilium.cc

[Trilium.cc](https://trilium.cc/) is a cloud service dedicated to hosting a Trilium instance.

> [!WARNING]
> Trilium.cc usually runs several versions behind Trilium releases.

## Matching your version with the cloud instance

Please note that once you set up <a class="reference-link" href="../Synchronization.md">Synchronization</a> between a cloud instance and [desktop](../Desktop%20Installation.md) clients, it's important that the version of the desktop application and the server match up.

When setting up a cloud instance, it's best to check the version of the server by accessing it via a web browser and going to the _About_ section. It's best that both the desktop and the server have the same _App version_; however it's generally OK to update the desktop to a newer version than the server if it has the same _Sync version_.

If the _Sync version_ between the server and the desktop application doesn't match, synchronization will not work.