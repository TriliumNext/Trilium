import { describe, expect, it } from "vitest";

import type NoteMeta from "@triliumnext/server/src/services/meta/note_meta.js";

import { parseNoteMetaFile, serverTextNoteHandler, standaloneTextNoteHandler } from "./help_meta_generator.js";

describe("Help meta generation (server)", () => {
    it("preserves custom folder icon", () => {
        const child: NoteMeta = {
            isClone: false,
            noteId: "yoAe4jV2yzbd",
            notePath: [ "OkOZllzB3fqN", "yoAe4jV2yzbd" ],
            title: "Features",
            notePosition: 40,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                { type: "label", name: "iconClass", value: "bx bx-star", isInheritable: false, position: 10 }
            ],
            format: "html",
            attachments: [],
            dirFileName: "Features",
            children: []
        };
        const root: NoteMeta = {
            isClone: false, noteId: "root", notePath: ["root"], title: "Root",
            notePosition: 1, prefix: null, isExpanded: false, type: "text",
            mime: "text/html", attributes: [], format: "html", attachments: [],
            dirFileName: "Root", children: [child]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [root] };
        const items = parseNoteMetaFile(metaFile, serverTextNoteHandler);
        const icon = items[0]?.attributes?.find((a) => a.name === "iconClass");
        expect(icon?.value).toBe("bx bx-star");
    });

    it("generates docUrl from shareAlias when baseUrl is provided", () => {
        const meta: NoteMeta = {
            isClone: false,
            noteId: "rootNote123",
            notePath: [ "rootNote123" ],
            title: "User Guide",
            notePosition: 1,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                { type: "label", name: "shareAlias", value: "user-guide", isInheritable: false, position: 10 }
            ],
            format: "html",
            dataFileName: "User Guide.html",
            dirFileName: "User Guide",
            attachments: [],
            children: [
                {
                    isClone: false,
                    noteId: "childNote456",
                    notePath: [ "rootNote123", "childNote456" ],
                    title: "Feature Highlights",
                    notePosition: 10,
                    prefix: null,
                    isExpanded: false,
                    type: "text",
                    mime: "text/html",
                    attributes: [
                        { type: "label", name: "shareAlias", value: "feature-highlights", isInheritable: false, position: 10 }
                    ],
                    format: "html",
                    dataFileName: "Feature Highlights.html",
                    attachments: [],
                    children: []
                }
            ]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [meta] };
        const items = parseNoteMetaFile(metaFile, serverTextNoteHandler, "https://docs.triliumnotes.org");

        const child = items[0];
        const docUrl = child?.attributes?.find((a) => a.name === "docUrl");
        expect(docUrl?.value).toBe("https://docs.triliumnotes.org/user-guide/feature-highlights");
    });

    it("omits docUrl when no baseUrl is provided", () => {
        const meta: NoteMeta = {
            isClone: false,
            noteId: "rootNote123",
            notePath: [ "rootNote123" ],
            title: "User Guide",
            notePosition: 1,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                { type: "label", name: "shareAlias", value: "user-guide", isInheritable: false, position: 10 }
            ],
            format: "html",
            dataFileName: "User Guide.html",
            dirFileName: "User Guide",
            attachments: [],
            children: [
                {
                    isClone: false,
                    noteId: "childNote456",
                    notePath: [ "rootNote123", "childNote456" ],
                    title: "Feature Highlights",
                    notePosition: 10,
                    prefix: null,
                    isExpanded: false,
                    type: "text",
                    mime: "text/html",
                    attributes: [
                        { type: "label", name: "shareAlias", value: "feature-highlights", isInheritable: false, position: 10 }
                    ],
                    format: "html",
                    dataFileName: "Feature Highlights.html",
                    attachments: [],
                    children: []
                }
            ]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [meta] };
        const items = parseNoteMetaFile(metaFile, serverTextNoteHandler);

        const child = items[0];
        const docUrl = child?.attributes?.find((a) => a.name === "docUrl");
        expect(docUrl).toBeUndefined();
    });

    it("hides note that is hidden from share tree", () => {
        const meta: NoteMeta = {
            isClone: false,
            noteId: "yoAe4jV2yzbd",
            notePath: [ "OkOZllzB3fqN", "yoAe4jV2yzbd" ],
            title: "Features",
            notePosition: 40,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                { type: "label", name: "shareHiddenFromTree", value: "", isInheritable: false, position: 10 }
            ],
            format: "html",
            attachments: [],
            dirFileName: "Features",
            children: []
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [meta] };
        const items = parseNoteMetaFile(metaFile, serverTextNoteHandler);
        expect(items).toHaveLength(0);
    });
});

describe("Help meta generation (standalone)", () => {
    it("converts text notes with URL to webView", () => {
        const child: NoteMeta = {
            isClone: false,
            noteId: "childNote456",
            notePath: [ "rootNote123", "childNote456" ],
            title: "Feature Highlights",
            notePosition: 10,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                { type: "label", name: "shareAlias", value: "feature-highlights", isInheritable: false, position: 10 }
            ],
            format: "html",
            dataFileName: "Feature Highlights.html",
            attachments: [],
            children: []
        };
        const root: NoteMeta = {
            isClone: false, noteId: "root", notePath: ["root"], title: "Root",
            notePosition: 1, prefix: null, isExpanded: false, type: "text",
            mime: "text/html", attributes: [
                { type: "label", name: "shareAlias", value: "root", isInheritable: false, position: 10 }
            ], format: "html", attachments: [],
            dirFileName: "Root", children: [child]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [root] };
        const items = parseNoteMetaFile(metaFile, standaloneTextNoteHandler, "https://docs.triliumnotes.org");

        expect(items).toHaveLength(1);
        expect(items[0].type).toBe("webView");
        expect(items[0].enforceAttributes).toBe(true);
        expect(items[0].attributes).toContainEqual({
            type: "label", name: "webViewSrc", value: "https://docs.triliumnotes.org/root/feature-highlights"
        });
        expect(items[0].attributes?.find(a => a.name === "docName")).toBeUndefined();
    });

    it("excludes text notes without URL", () => {
        const child: NoteMeta = {
            isClone: false,
            noteId: "childNote456",
            notePath: [ "rootNote123", "childNote456" ],
            title: "Feature Highlights",
            notePosition: 10,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [],
            format: "html",
            dataFileName: "Feature Highlights.html",
            attachments: [],
            children: []
        };
        const root: NoteMeta = {
            isClone: false, noteId: "root", notePath: ["root"], title: "Root",
            notePosition: 1, prefix: null, isExpanded: false, type: "text",
            mime: "text/html", attributes: [], format: "html", attachments: [],
            dirFileName: "Root", children: [child]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [root] };
        const items = parseNoteMetaFile(metaFile, standaloneTextNoteHandler);
        expect(items).toHaveLength(0);
    });

    it("preserves folder notes", () => {
        const child: NoteMeta = {
            isClone: false,
            noteId: "folderNote",
            notePath: [ "root", "folderNote" ],
            title: "Section",
            notePosition: 1,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [],
            format: "html",
            attachments: [],
            dirFileName: "Section",
            children: []
        };
        const root: NoteMeta = {
            isClone: false, noteId: "root", notePath: ["root"], title: "Root",
            notePosition: 1, prefix: null, isExpanded: false, type: "text",
            mime: "text/html", attributes: [], format: "html", attachments: [],
            dirFileName: "Root", children: [child]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [root] };
        const items = parseNoteMetaFile(metaFile, standaloneTextNoteHandler);

        expect(items).toHaveLength(1);
        expect(items[0].type).toBe("book");
    });
});
