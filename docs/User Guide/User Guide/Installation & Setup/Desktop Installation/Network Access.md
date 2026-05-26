# Network Access
The Trilium desktop app opens a TCP port (usually `37840`) for the following reasons:

*   Integration with the <a class="reference-link" href="#root/jdjRLhLV3TtI/yeqU0zo0ZQ83/YTAxJMA3uWwn">Web Clipper</a>.
*   Desktop-to-desktop <a class="reference-link" href="../Synchronization.md">Synchronization</a>.
*   Making Trilium accessible over the web, similar to a <a class="reference-link" href="../Server%20Installation.md">Server Installation</a>. See <a class="reference-link" href="Using%20the%20desktop%20application%20.md">Using the desktop application as a server</a>.

## Enabling access on the LAN

Before v0.104.0, this port was open for the entire local network. After v0.104.0 the port is open only on `localhost` (127.0.0.1). This prevents other devices on the same network — and websites you open in another browser on the same machine — from reaching the Trilium API. If you don't use the desktop as a sync source, remote server, you don't need to change anything.

To open the port on all networks, modify [config.ini](../../Advanced%20Usage/Configuration%20\(config.ini%20or%20e.md) as follows:

```
[Network]
host=0.0.0.0
```

> [!NOTE]
> If you use the <a class="reference-link" href="#root/jdjRLhLV3TtI/yeqU0zo0ZQ83/YTAxJMA3uWwn">Web Clipper</a> on the same device as the one running the desktop application, there is no need to enable access on the LAN.