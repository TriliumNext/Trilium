"use strict";

import fs from "fs";
import dataDir from "./data_dir.js";
import { getLog } from "@triliumnext/core";
import { randomSecureToken } from "./utils.js";

const sessionSecretPath = `${dataDir.TRILIUM_DATA_DIR}/session_secret.txt`;

let sessionSecret: string;

const ENCODING = "ascii";

if (!fs.existsSync(sessionSecretPath)) {
    sessionSecret = randomSecureToken(64).slice(0, 64);

    getLog().info("Generated session secret");

    // Readable only by the server's user, since it signs the sessions and the CSRF tokens.
    fs.writeFileSync(sessionSecretPath, sessionSecret, { encoding: ENCODING, mode: 0o600 });
} else {
    sessionSecret = fs.readFileSync(sessionSecretPath, ENCODING);
}

export default sessionSecret;
