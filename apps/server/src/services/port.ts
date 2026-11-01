import config, { DEFAULT_NETWORK_PORT } from "./config.js";
import { isDev, isElectron } from "./utils.js";
import dataDir from "./data_dir.js";

function parseAndValidate(portStr: string, source: string) {
    const portNum = parseInt(portStr);

    if (isNaN(portNum) || portNum < 0 || portNum >= 65536) {
        console.log(`FATAL ERROR: Invalid port value "${portStr}" from ${source}, should be an integer between 0 and 65536.`);
        process.exit(-1);
    }

    return portNum;
}

let port: number;

if (process.env.TRILIUM_PORT) {
    port = parseAndValidate(process.env.TRILIUM_PORT, "environment variable TRILIUM_PORT");
} else if (isElectron) {
    port = isDev ? 37740 : 37840;
} else {
    port = parseAndValidate(config["Network"]["port"] || DEFAULT_NETWORK_PORT, `Network.port in ${dataDir.CONFIG_INI_PATH}`);
}

export default port;
