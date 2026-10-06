import fs from "fs";
import type { AddressInfo } from "net";
import path from "path";

/** Names the docker healthcheck script looks for, relative to the data directory. */
export const HEALTHCHECK_URL_FILE = "healthcheck-url";
export const HEALTHCHECK_SOCKET_FILE = "healthcheck-socket";

const PROBE_PATH = "/api/health-check";

/**
 * Records where the server is listening so the docker healthcheck can probe it without resolving
 * any configuration of its own. It writes the address that was actually bound rather than the one
 * that was configured, and runs once the server is listening, so the files existing at all means
 * the server got that far.
 */
export function publishHealthcheckTarget(
    dataDirPath: string,
    address: string | AddressInfo | null,
    overTls: boolean
) {
    const scheme = overTls ? "https" : "http";
    const urlFile = path.join(dataDirPath, HEALTHCHECK_URL_FILE);
    const socketFile = path.join(dataDirPath, HEALTHCHECK_SOCKET_FILE);

    if (address === null) {
        return;
    }

    if (typeof address === "string") {
        // A unix socket carries no host, so curl needs the path passed separately.
        replaceFile(urlFile, `${scheme}://localhost${PROBE_PATH}`);
        replaceFile(socketFile, address);

        return;
    }

    replaceFile(urlFile, `${scheme}://${probeHost(address)}:${address.port}${PROBE_PATH}`);
    fs.rmSync(socketFile, { force: true });
}

/**
 * Removes `file` before writing it, which needs write access to the directory only. A file left
 * by an earlier run as another user (root, or a different `--user`) cannot be written in place.
 */
function replaceFile(file: string, content: string) {
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, content);
}

/** The address a probe on the same host should dial, given what the server bound. */
function probeHost({ address, family }: AddressInfo) {
    if (address === "0.0.0.0") {
        return "127.0.0.1";
    }
    if (address === "::" || address === "::0") {
        return "[::1]";
    }

    return family === "IPv6" ? `[${address}]` : address;
}
