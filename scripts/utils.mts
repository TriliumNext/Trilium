import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { platform } from "os";

export function isNixOS() {
    if (platform() !== "linux") return false;

    const osReleasePath = "/etc/os-release";
    if (existsSync(osReleasePath)) {
        const osReleaseFile = readFileSync(osReleasePath, "utf-8");
        return osReleaseFile.includes("ID=nixos");
    } else {
        return !!process.env.NIX_STORE;
    }
}

function resetPath() {
    // On Unix-like systems, PATH is usually inherited from login shell
    // but npm prepends node_modules/.bin. Let's remove it:
    const origPath = process.env.PATH || "";

    // npm usually adds something like ".../node_modules/.bin"
    process.env.PATH = origPath
        .split(":")
        .filter(p => !p.includes("node_modules/.bin"))
        .join(":");
}

export function getElectronPath() {
    if (isNixOS()) {
        resetPath();            

        try {
            const path = execSync("which electron").toString("utf-8").trimEnd();
            return path;
        } catch (e) {
            // Nothing to do, since we have a fallback below.
        }

        console.log("Using default since no Electron is available in path.");
        return execSync("nix eval --raw nixpkgs#electron_37").toString("utf-8") + "/bin/electron";
    } else {
        return "electron";
    }
}