import { describe, expect, it } from "vitest";

import NoteMeta, { NoteMetaFile } from "../meta/note_meta";
import { previewMeta } from "./zip_preview";

describe("Preview meta", () => {
    it("identifies dangerous attributes", () => {
        const meta = wrapMeta({
            title: "First unsafe note",
            attributes: [
                {
                    type: "label",
                    name: "widget",
                    value: ""
                }
            ],
            children: [
                {
                    title: "Sub unsafe note",
                    attributes: [
                        {
                            type: "relation",
                            name: "runOnBranchCreation",
                            value: ""
                        }
                    ]
                }
            ]
        }, {
            title: "Second unsafe note",
            attributes: [
                {
                    type: "label",
                    name: "customRequestHandler",
                    value: ""
                },
                {
                    type: "label",
                    name: "safe",
                    value: ""
                }
            ],
            attachments: [
                {
                    attachmentId: "YRAEUXCDKNtn",
                    title: "icon-color.svg",
                    role: "image",
                    mime: "image/svg+xml",
                    position: 10,
                    dataFileName: "Trilium Demo_icon-color.svg"
                }
            ]
        });
        const result = previewMeta(meta);
        expect(result.numNotes).toBe(3);
        expect(result.numAttributes).toBe(4);
        expect(result.numAttachments).toBe(1);
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousAttributes).toContain("widget");
        expect(result.dangerousAttributes).toContain("customRequestHandler");
        expect(result.dangerousAttributes).toContain("runOnBranchCreation");
        expect(result.dangerousAttributeCategories).toContain("serverSideScripting");
        expect(result.dangerousAttributeCategories).toContain("clientSideScripting");
    });
});

function wrapMeta(...noteMeta: NoteMeta[]): NoteMetaFile {
    return {
        formatVersion: 2,
        appVersion: "0.101.3-test-260207-031832",
        files: noteMeta
    };
};
