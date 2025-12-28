import { readFileSync, writeFileSync } from "fs";
import { parseString } from '@fast-csv/parse';

const csvPath = process.argv[2];
const translationPath = process.argv[3];

if (!csvPath || !translationPath) {
    console.log("Usage: input.csv translation.json")
    process.exit(1);
}

const csvFile = readFileSync(csvPath, "utf-8");
const translationFile = readFileSync(translationPath, "utf-8");
const translation = JSON.parse(translationFile);

parseString(csvFile, { headers: true })
    .on("error", error => {
        console.error(error);
        process.exit(2);
    })
    .on("data", data => {
        replaceTranslation(data.context, data.target);
    })
    .on("end", () => {
        writeFileSync(translationPath, JSON.stringify(translation, null, 2));
    });

function replaceTranslation(path: string, value: string) {
    let cursor = translation;
    const segments = path.split(".");
    const lastSegment = segments.pop();
    for (const current of segments) {
        if (!cursor[current]) cursor[current] = {};
        cursor = cursor[current];
    }

    if (lastSegment) cursor[lastSegment] = value;
}
