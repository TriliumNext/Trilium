import { describe, expect, it } from "vitest";
import { rewriteMarkdownContentLinks } from "./rewrite_links.js";
import type { NoteMeta } from "../../meta.js";

function buildNoteMeta(attachments: Array<{ attachmentId: string; dataFileName: string }>): NoteMeta {
    return {
        noteId: "testNote1",
        notePath: ["root", "testNote1"],
        attachments: attachments.map((a) => ({
            ...a,
            title: a.dataFileName,
            role: "image" as const,
            mime: "image/jpeg",
            position: 0
        }))
    };
}

const nullNoteUrl = () => null;

describe("rewriteMarkdownContentLinks", () => {
    describe("attachment images", () => {
        it("rewrites attachment image URL to data filename", () => {
            const content = "![Photo.jpeg](api/attachments/abc123/image/Photo.jpeg)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_Photo.jpeg" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("![Photo.jpeg](Note_Photo.jpeg)");
        });

        it("preserves attachment URL when attachment is not found in noteMeta", () => {
            const content = "![Photo.jpeg](api/attachments/unknown123/image/Photo.jpeg)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });

        it("rewrites multiple attachment images", () => {
            const content = [
                "![img1](api/attachments/att1/image/a.png)",
                "",
                "![img2](api/attachments/att2/image/b.png)"
            ].join("\n");
            const noteMeta = buildNoteMeta([
                { attachmentId: "att1", dataFileName: "Note_a.png" },
                { attachmentId: "att2", dataFileName: "Note_b.png" }
            ]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("![img1](Note_a.png)\n\n![img2](Note_b.png)");
        });

        it("handles attachment URL with generic 'image' as filename", () => {
            const content = "![Photo from 2024-02-21 19-41-25.225874.jpeg](api/attachments/y9zRJ8HJmJRC/image/image)";
            const noteMeta = buildNoteMeta([
                { attachmentId: "y9zRJ8HJmJRC", dataFileName: "Note_Photo from 2024-02-21 19-41-25.225874.jpeg" }
            ]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("![Photo from 2024-02-21 19-41-25.225874.jpeg](Note_Photo from 2024-02-21 19-41-25.225874.jpeg)");
        });

        it("handles URL-encoded attachment paths", () => {
            const content = "![photo](api/attachments/abc123/image/Photo%20Name.jpeg)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_Photo Name.jpeg" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("![photo](Note_Photo Name.jpeg)");
        });

        it("handles attachment URL with leading slash", () => {
            const content = "![photo](./api/attachments/abc123/image/photo.png)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_photo.png" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("![photo](Note_photo.png)");
        });
    });

    describe("image notes", () => {
        it("rewrites image note URL to target path", () => {
            const content = "![diagram](api/images/imgNote1/diagram.png)";
            const noteMeta = buildNoteMeta([]);
            const getNoteTargetUrl = (noteId: string) => noteId === "imgNote1" ? "../images/diagram.png" : null;

            expect(rewriteMarkdownContentLinks(content, noteMeta, getNoteTargetUrl))
                .toBe("![diagram](../images/diagram.png)");
        });

        it("preserves image note URL when note not found in export", () => {
            const content = "![diagram](api/images/imgNote1/diagram.png)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });
    });

    describe("internal note links", () => {
        it("rewrites internal note link to target path", () => {
            const content = "[My Note](#root/abc123/def456)";
            const noteMeta = buildNoteMeta([]);
            const getNoteTargetUrl = (noteId: string) => noteId === "def456" ? "../Other/My Note.md" : null;

            expect(rewriteMarkdownContentLinks(content, noteMeta, getNoteTargetUrl))
                .toBe("[My Note](../Other/My Note.md)");
        });

        it("preserves internal note link when note not found in export", () => {
            const content = "[My Note](#root/abc123/def456)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });
    });

    describe("attachment download links", () => {
        it("rewrites attachment download link to data filename", () => {
            const content = "[document.pdf](#root/noteId123?attachmentId=att456)";
            const noteMeta = buildNoteMeta([{ attachmentId: "att456", dataFileName: "Note_document.pdf" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe("[document.pdf](Note_document.pdf)");
        });

        it("preserves attachment download link when attachment not found", () => {
            const content = "[document.pdf](#root/noteId123?attachmentId=unknownAtt)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });
    });

    describe("non-Trilium URLs", () => {
        it("preserves external URLs", () => {
            const content = "![logo](https://example.com/logo.png)\n[link](https://example.com)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });

        it("preserves relative URLs that are not API paths", () => {
            const content = "![img](./images/photo.png)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl))
                .toBe(content);
        });
    });

    describe("mixed content", () => {
        it("rewrites all link types in a single document", () => {
            const content = [
                "# My Note",
                "",
                "Here is an image: ![photo](api/attachments/att1/image/photo.png)",
                "",
                "And a [link to another note](#root/parent1/note2).",
                "",
                "External link: [Google](https://google.com)",
                "",
                "Download: [file.pdf](#root/note1?attachmentId=att2)"
            ].join("\n");

            const noteMeta = buildNoteMeta([
                { attachmentId: "att1", dataFileName: "Note_photo.png" },
                { attachmentId: "att2", dataFileName: "Note_file.pdf" }
            ]);
            const getNoteTargetUrl = (noteId: string) => noteId === "note2" ? "../Other/Note2.md" : null;

            const expected = [
                "# My Note",
                "",
                "Here is an image: ![photo](Note_photo.png)",
                "",
                "And a [link to another note](../Other/Note2.md).",
                "",
                "External link: [Google](https://google.com)",
                "",
                "Download: [file.pdf](Note_file.pdf)"
            ].join("\n");

            expect(rewriteMarkdownContentLinks(content, noteMeta, getNoteTargetUrl))
                .toBe(expected);
        });
    });
});
