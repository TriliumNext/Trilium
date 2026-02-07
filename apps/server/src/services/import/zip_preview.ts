import { DangerousAttributeCategory, ImportPreviewResponse } from "@triliumnext/commons";

import ValidationError from "../../errors/validation_error";
import { DangerousAttributeInfo } from "../builtin_attributes";
import BUILTIN_ATTRIBUTES from "../builtin_attributes.js";
import NoteMeta, { NoteMetaFile } from "../meta/note_meta";
import { normalizeFilePath, readContent, readZipFile } from "./zip";

export default async function previewZipForImport(bufferOrPath: string | Buffer) {
    let metaFile: NoteMetaFile | null = null;

    await readZipFile(bufferOrPath, async (zipfile, entry) => {
        const filePath = normalizeFilePath(entry.fileName);

        if (filePath === "!!!meta.json") {
            const content = await readContent(zipfile, entry);
            metaFile = JSON.parse(content.toString("utf-8")) as NoteMetaFile;
        }

        zipfile.readEntry();
    });

    if (!metaFile) {
        throw new ValidationError("Missing meta file.");
    }

    const previewResults = previewMeta(metaFile);
    return previewResults;
}

interface PreviewContext {
    dangerousAttributes: Set<string>;
    dangerousAttributeCategories: Set<DangerousAttributeCategory>;
    numNotes: number;
    numAttributes: number;
}

export function previewMeta(meta: NoteMetaFile): Omit<ImportPreviewResponse, "id" | "fileName"> {
    const context: PreviewContext = {
        dangerousAttributes: new Set<string>(),
        dangerousAttributeCategories: new Set<DangerousAttributeCategory>(),
        numNotes: 0,
        numAttributes: 0
    };
    previewMetaInternal(meta.files, context);

    return {
        isDangerous: context.dangerousAttributes.size > 0,
        dangerousAttributes: Array.from(context.dangerousAttributes),
        dangerousAttributeCategories: Array.from(context.dangerousAttributeCategories),
        numNotes: context.numNotes,
        numAttributes: context.numAttributes
    };
}


function previewMetaInternal(metaFiles: NoteMeta[], context: PreviewContext) {
    for (const metaFile of metaFiles) {
        context.numNotes++;

        // Look through the attributes for dangerous ones.
        if (metaFile.attributes) {
            for (const { name, type } of metaFile.attributes) {
                context.numAttributes++;
                const dangerousAttribute = BUILTIN_ATTRIBUTES.find((attr) =>
                    attr.type === type &&
                    attr.name.toLowerCase() === name.trim().toLowerCase() && attr.isDangerous) as DangerousAttributeInfo | undefined;
                if (!dangerousAttribute) continue;

                context.dangerousAttributes.add(name);
                context.dangerousAttributeCategories.add(dangerousAttribute.dangerCategory);
            }
        }

        if (metaFile.children) {
            previewMetaInternal(metaFile.children, context);
        }
    }
}
