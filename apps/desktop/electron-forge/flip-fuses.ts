/**
 * The Electron fuse hardening shared by every packaged build. electron-forge
 * burns {@link FUSES} in through its fuses plugin, layering the two asar
 * fuses on top in forge.config.ts; the Flathub build, which loads the app
 * from a plain directory the asar fuses would forbid, runs this file as a
 * script, with tsx, to flip the set on its unpacked Electron binary.
 */

import type { FuseConfig } from "@electron/fuses";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";

export const FUSES: FuseConfig = {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
};

// Only when run as a script — the Flathub build passes its unpacked Electron binary.
if (process.argv[1] === import.meta.filename) {
    const binaryPath = process.argv[2];
    if (!binaryPath) {
        throw new Error("Pass the Electron binary to flip fuses on.");
    }
    flipFuses(binaryPath, FUSES).then(
        () => console.log(`Flipped fuses on ${binaryPath}`),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}
