import config from "./config.js";
import { isElectron } from "./utils.js";

function getHost() {
    if (isElectron) {
        // Desktop ignores the [Network] host config — that setting is for web
        // deployments. The renderer reaches the server in-process via
        // `trilium-app://`, so the TCP listener binds loopback and stays off the
        // LAN by default. The user opts into LAN access (e.g. to sync from
        // another device) with the `allowLanAccess` security override, which the
        // desktop main process applies to the config at startup.
        return config["Security"]["allowLanAccess"] ? "0.0.0.0" : "127.0.0.1";
    }

    const envHost = process.env.TRILIUM_HOST;
    if (envHost) {
        return envHost;
    }

    return config["Network"]["host"];
}

export default getHost();
