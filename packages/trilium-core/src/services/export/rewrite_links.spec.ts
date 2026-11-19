import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../meta.js";
import {
    getArchivedLinkSuffix, getLinkAttachmentId, getLinkTargetParameters, rewriteMarkdownContentLinks
} from "./rewrite_links.js";

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
const nullAttachmentUrl = () => null;

/** The file of the attachment `att456` of the note `owner1`, the one attachment of an export. */
function ownerAttachmentUrl(ownerId: string, attachmentId: string) {
    return ownerId === "owner1" && attachmentId === "att456" ? "../Docs/Owner_document.pdf" : null;
}

describe("getArchivedLinkSuffix", () => {
    const suffix = "?heading=h%201&viewMode=attachments&amp;annotation=12R&ntxId=x&page=3"
        + "&bookmark=Set%20up&block=a:b";

    it("keeps the link target parameters in their order as written", () => {
        expect(getArchivedLinkSuffix(suffix, "attribute")).toBe(
            "?block=a:b&amp;bookmark=Set%20up&amp;page=3&amp;annotation=12R&amp;heading=h%201");
        expect(getArchivedLinkSuffix(suffix, "markdown"))
            .toBe("?block=a:b&bookmark=Set%20up&page=3&annotation=12R&heading=h%201");
    });

    it("reads the fragment as the bookmark and the first value of a parameter that has one", () => {
        expect(getArchivedLinkSuffix("?page=&page=4&page=5&flag&=x#mark", "markdown"))
            .toBe("?bookmark=mark&page=4");
        expect(getArchivedLinkSuffix("?bookmark=query#fragment", "markdown"))
            .toBe("?bookmark=fragment");
        expect(getArchivedLinkSuffix("?viewMode=source", "attribute")).toBe("");
        expect(getArchivedLinkSuffix("", "markdown")).toBe("");
    });
});

describe("getLinkTargetParameters", () => {
    it("follows a query that has begun, with the separator of the context", () => {
        const suffix = "?viewMode=attachments&amp;attachmentId=a1&amp;heading=h1&amp;page=3";

        expect(getLinkTargetParameters(suffix, "attribute")).toBe("&amp;page=3&amp;heading=h1");
        expect(getLinkTargetParameters(suffix, "markdown")).toBe("&page=3&heading=h1");
        expect(getLinkTargetParameters("?viewMode=attachments", "attribute")).toBe("");
    });
});

describe("getLinkAttachmentId", () => {
    it("reads the attachment that the query of a link names", () => {
        expect(getLinkAttachmentId("?viewMode=attachments&amp;attachmentId=a_1/&amp;page=3"))
            .toBe("a_1");
        expect(getLinkAttachmentId("?attachmentId=a2")).toBe("a2");
        expect(getLinkAttachmentId("?viewMode=attachments&xattachmentId=a3")).toBeUndefined();
    });
});

describe("rewriteMarkdownContentLinks", () => {
    describe("attachment images", () => {
        it("rewrites attachment image URL to data filename", () => {
            const content = "![Photo.jpeg](api/attachments/abc123/image/Photo.jpeg)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_Photo.jpeg" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe("![Photo.jpeg](Note_Photo.jpeg)");
        });

        it("preserves attachment URL when attachment is not found in noteMeta", () => {
            const content = "![Photo.jpeg](api/attachments/unknown123/image/Photo.jpeg)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
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

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe("![img1](Note_a.png)\n\n![img2](Note_b.png)");
        });

        it("handles attachment URL with generic 'image' as filename", () => {
            const content = "![Photo from 2024-02-21 19-41-25.225874.jpeg](api/attachments/y9zRJ8HJmJRC/image/image)";
            const noteMeta = buildNoteMeta([
                { attachmentId: "y9zRJ8HJmJRC", dataFileName: "Note_Photo from 2024-02-21 19-41-25.225874.jpeg" }
            ]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe("![Photo from 2024-02-21 19-41-25.225874.jpeg](Note_Photo from 2024-02-21 19-41-25.225874.jpeg)");
        });

        it("handles URL-encoded attachment paths", () => {
            const content = "![photo](api/attachments/abc123/image/Photo%20Name.jpeg)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_Photo Name.jpeg" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe("![photo](Note_Photo Name.jpeg)");
        });

        it("preserves attachment links when the note meta carries no attachments key at all", () => {
            // `attachments` is optional on NoteMeta, so a note that never had any is exported without it.
            const noteMeta: NoteMeta = { noteId: "testNote1", notePath: ["root", "testNote1"] };
            const content = [
                "![photo](api/attachments/att1/image/photo.png)",
                "[doc.pdf](#root/note1?attachmentId=att2)"
            ].join("\n");

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe(content);
        });

        it("handles attachment URL with leading slash", () => {
            const content = "![photo](./api/attachments/abc123/image/photo.png)";
            const noteMeta = buildNoteMeta([{ attachmentId: "abc123", dataFileName: "Note_photo.png" }]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe("![photo](Note_photo.png)");
        });
    });

    describe("image notes", () => {
        it("rewrites image note URL to target path", () => {
            const content = "![diagram](api/images/imgNote1/diagram.png)";
            const noteMeta = buildNoteMeta([]);
            const getNoteTargetUrl = (noteId: string) => noteId === "imgNote1" ? "../images/diagram.png" : null;

            expect(rewriteMarkdownContentLinks(
                content, noteMeta, getNoteTargetUrl, nullAttachmentUrl
            )).toBe("![diagram](../images/diagram.png)");
        });

        it("preserves image note URL when note not found in export", () => {
            const content = "![diagram](api/images/imgNote1/diagram.png)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe(content);
        });
    });

    describe("internal note links", () => {
        it("rewrites internal note link to target path", () => {
            const content = "[My Note](#root/abc123/def456)";
            const noteMeta = buildNoteMeta([]);
            const getNoteTargetUrl = (noteId: string) => noteId === "def456" ? "../Other/My Note.md" : null;

            expect(rewriteMarkdownContentLinks(
                content, noteMeta, getNoteTargetUrl, nullAttachmentUrl
            )).toBe("[My Note](../Other/My Note.md)");
        });

        it("preserves internal note link when note not found in export", () => {
            const content = "[My Note](#root/abc123/def456)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe(content);
        });

        it("keeps the blocks and the bookmark that the link points at", () => {
            const content = "[a](#root/abc123/def456?block=x:y)"
                + " [b](#root/def456?viewMode=source&bookmark=Set%20up&block=z)"
                + " [c](#root/def456?ntxId=1)";
            const getNoteTargetUrl = (noteId: string) => noteId === "def456" ? "Other.md" : null;

            const rewritten = rewriteMarkdownContentLinks(
                content, buildNoteMeta([]), getNoteTargetUrl, nullAttachmentUrl);

            expect(rewritten).toBe(
                "[a](Other.md?block=x:y) [b](Other.md?block=z&bookmark=Set%20up) [c](Other.md)");
        });
    });

    describe("attachment download links", () => {
        it("rewrites a link to the file of the attachment its owner holds, with its target", () => {
            const content = "[document.pdf](#root/owner1?viewMode=attachments&attachmentId=att456)"
                + " [page](#root/a1/owner1?viewMode=attachments&attachmentId=att456"
                + "&heading=h%201&page=3&ntxId=x)";

            expect(rewriteMarkdownContentLinks(
                content, buildNoteMeta([]), nullNoteUrl, ownerAttachmentUrl
            )).toBe("[document.pdf](../Docs/Owner_document.pdf)"
                + " [page](../Docs/Owner_document.pdf?page=3&heading=h%201)");
        });

        it("leaves a link to an attachment that the export does not hold as written", () => {
            // Every note is exported here, so only the missing attachment keeps the link as written.
            const content = "[gone](#root/owner1?viewMode=attachments&attachmentId=unknown&page=3)"
                + " [outside](#root/outside1?viewMode=attachments&attachmentId=att456)";
            const getNoteTargetUrl = () => "Owner.md";

            expect(rewriteMarkdownContentLinks(
                content, buildNoteMeta([]), getNoteTargetUrl, ownerAttachmentUrl
            )).toBe(content);
        });
    });

    describe("non-Trilium URLs", () => {
        it("preserves external URLs", () => {
            const content = "![logo](https://example.com/logo.png)\n[link](https://example.com)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
                .toBe(content);
        });

        it("preserves relative URLs that are not API paths", () => {
            const content = "![img](./images/photo.png)";
            const noteMeta = buildNoteMeta([]);

            expect(rewriteMarkdownContentLinks(content, noteMeta, nullNoteUrl, nullAttachmentUrl))
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
                "Download: [file.pdf](#root/owner1?attachmentId=att456)"
            ].join("\n");

            const noteMeta = buildNoteMeta([
                { attachmentId: "att1", dataFileName: "Note_photo.png" }
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
                "Download: [file.pdf](../Docs/Owner_document.pdf)"
            ].join("\n");

            expect(rewriteMarkdownContentLinks(
                content, noteMeta, getNoteTargetUrl, ownerAttachmentUrl
            )).toBe(expected);
        });
    });
});
