import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const inputDir = process.argv[2];
if (!inputDir) {
    console.error('Please provide the input directory as the first argument.');
    process.exit(1);
}

for (const weight of [ "200", "400" ]) {
    const jsonPath = `${inputDir}/${weight}/boxicons.json`;
    const inputData = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const icons = {};

    for (const [ key, value ] of Object.entries(inputData)) {
        let name = key;
        if (name.startsWith('bx-')) {
            name = name.slice(3);
        }
        if (name.startsWith('bxs-')) {
            name = name.slice(4);
        }
        icons[key] = {
            glyph: String.fromCharCode(value as number),
            terms: [ name ]
        };
    }

    const manifest = {
        prefix: `bx3-${weight}`,
        icons
    };
    const outputPath = join(`${inputDir}/${weight}/generated-manifest.json`);
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
}
