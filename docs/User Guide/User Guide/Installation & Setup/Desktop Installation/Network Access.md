# Network Access
Prior to v0.104.0, the [desktop application](../Desktop%20Installation.md) would also open a network port so that it can offer access to <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> or even use it as a web server (see <a class="reference-link" href="Using%20the%20desktop%20application%20as%20a%20server.md">Using the desktop application as a server</a>).

In order to reduce the attack surface, Trilium now enables these services only for the local device (e.g. `localhost`) instead of serving them over the LAN.

To better understand what is affected, refer to the following table:

| Feature | Network access OFF | Network access ON |
| --- | --- | --- |
| <a class="reference-link" href="../Web%20Clipper.md">Web Clipper</a> | 🔒️ `localhost` only (still accessible to the browser extension on the same device) | 🌐 `localhost` + LAN |
| <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> | 🔒️ `localhost` only | 🌐 `localhost` + LAN |
| [LLM MCP](../../AI.md) (only if enabled in settings) | 🔒️ `localhost` only (needs auth) | 🌐 `localhost` + LAN (needs auth) |
| [Web app](Using%20the%20desktop%20application%20as%20a%20server.md) | ❌️ completely disabled (403), only the desktop app is usable. | 🌐 `localhost` + LAN |
| <a class="reference-link" href="../../Advanced%20Usage/Sharing.md">Sharing</a> notes | ❌️ completely disabled (403), if you are using <a class="reference-link" href="../Synchronization.md">Synchronization</a> this will still work as part of the [server](../Server%20Installation.md). | 🌐 `localhost` + LAN |