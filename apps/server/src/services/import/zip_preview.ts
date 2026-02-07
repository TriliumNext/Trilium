import { normalizeFilePath, readContent, readZipFile } from "./zip";

export default async function previewZipForImport(buffer: Buffer) {
    await readZipFile(buffer, async (zipfile, entry) => {
        const filePath = normalizeFilePath(entry.fileName);

        if (filePath === "!!!meta.json") {
            const content = await readContent(zipfile, entry);
            const meta = JSON.parse(content.toString("utf-8"));

            console.log("Got ", meta);
        }

        zipfile.readEntry();
    });
}
