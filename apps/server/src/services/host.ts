import config from "./config.js";
import { isElectron } from "./utils.js";

function getHost() {
    const envHost = process.env.TRILIUM_HOST;
    if (envHost && !isElectron) {
        return envHost;
    }

    const configHost = config["Network"]["host"];
    if (configHost) {
        return configHost;
    }

    // The desktop renderer talks to the server via the `trilium-app://`
    // custom protocol (in-process); the TCP listener only needs to serve
    // same-host traffic (the renderer's WebSocket). Binding loopback by
    // default keeps the local port off the LAN — defense in depth on top
    // of the per-request auth marker. A user who wants LAN access can still
    // set `[Network] host=` in config.ini.
    return isElectron ? "127.0.0.1" : "0.0.0.0";
}

export default getHost();
