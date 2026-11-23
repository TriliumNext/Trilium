import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { findOnPath } from "./browser.ts";
import { outDir } from "./build.ts";
import type { Bezel } from "./scenes.ts";

const DOWNLOAD_URL = "https://devimages-cdn.apple.com/design/resources/download/";
const cacheDir = path.join(outDir, "bezels");

/**
 * The PNG of `bezel`, from Apple's product bezels. Apple's license allows them in App Store
 * marketing but not their redistribution, so they stay out of the repository: the build downloads
 * the disk image once, extracts the one PNG with `7z` into `out/bezels` and deletes the image.
 */
export async function fetchBezel(bezel: Bezel) {
    const target = path.join(cacheDir, path.basename(bezel.file));
    if (fs.existsSync(target)) return target;

    const sevenZip = process.env.SEVEN_ZIP ?? findOnPath("7z") ?? findOnPath("7zz");
    if (!sevenZip) throw new Error("Extracting Apple's product bezels needs 7z on the PATH.");
    const workDir = fs.mkdtempSync(path.join(cacheDir + "-"));
    try {
        const image = path.join(workDir, bezel.image);
        console.log(`  Downloading ${bezel.image}...`);
        const response = await fetch(DOWNLOAD_URL + encodeURIComponent(bezel.image));
        if (!response.ok) {
            throw new Error(`Downloading ${bezel.image} failed (${response.status}).`);
        }
        fs.writeFileSync(image, Buffer.from(await response.arrayBuffer()));
        execFileSync(sevenZip, [ "e", "-y", `-o${workDir}`, image, bezel.file ],
            { stdio: "ignore" });
        const extracted = path.join(workDir, path.basename(bezel.file));
        if (!fs.existsSync(extracted)) throw new Error(`${bezel.image} has no ${bezel.file}.`);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.renameSync(extracted, target);
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
    return target;
}
