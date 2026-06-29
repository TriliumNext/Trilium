import type { HiddenSubtreeItem } from "@triliumnext/commons";
import type { NoteMeta } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

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

    it("resolves a cloned note's iconClass and docName to the primary occurrence", () => {
        // The same note is placed under two folders: a primary occurrence (isClone:false) carrying
        // a custom icon, and a clone (isClone:true) with no attributes and a ".clone" data file.
        // Both occurrences map to the same noteId, so the runtime hidden-subtree check enforces one
        // set of attributes; if the generator emits different iconClass/docName per occurrence, that
        // check flip-flops them on every run. The clone must therefore inherit the primary's values.
        const primary: NoteMeta = {
            isClone: false, noteId: "nix", title: "Nix flake", type: "text", mime: "text/html",
            attributes: [{ type: "label", name: "iconClass", value: "bx bxl-tux", isInheritable: false, position: 10 }],
            format: "html", dataFileName: "Nix flake.html", children: []
        };
        const clone: NoteMeta = {
            isClone: true, noteId: "nix", title: "Nix flake", type: "text", mime: "text/html",
            format: "html", dataFileName: "Nix flake.clone.html", children: []
        };
        const desktop: NoteMeta = {
            isClone: false, noteId: "desktop", title: "Desktop Installation", type: "text", mime: "text/html",
            attributes: [], format: "html", dirFileName: "Desktop Installation", children: [primary]
        };
        const server: NoteMeta = {
            isClone: false, noteId: "server", title: "Server Installation", type: "text", mime: "text/html",
            attributes: [], format: "html", dirFileName: "Server Installation", children: [clone]
        };
        const root: NoteMeta = {
            isClone: false, noteId: "root", title: "User Guide", type: "text", mime: "text/html",
            attributes: [], format: "html", dirFileName: "User Guide", children: [desktop, server]
        };

        const metaFile = { formatVersion: 2, appVersion: "0.103.0", files: [root] };
        const items = parseNoteMetaFile(metaFile, serverTextNoteHandler);

        const primaryItem = items.find((i) => i.id === "_help_desktop")?.children?.[0];
        const cloneItem = items.find((i) => i.id === "_help_server")?.children?.[0];
        expect(primaryItem?.id).toBe("_help_nix");
        expect(cloneItem?.id).toBe("_help_nix");

        const iconOf = (it?: HiddenSubtreeItem) => it?.attributes?.find((a) => a.name === "iconClass")?.value;
        const docNameOf = (it?: HiddenSubtreeItem) => it?.attributes?.find((a) => a.name === "docName")?.value;

        // The clone inherits the primary's custom icon rather than falling back to "bx bx-file".
        expect(iconOf(primaryItem)).toBe("bx bxl-tux");
        expect(iconOf(cloneItem)).toBe("bx bxl-tux");
        // Both point at the same documentation file (the primary's), not the clone's ".clone" path.
        expect(docNameOf(cloneItem)).toBe(docNameOf(primaryItem));
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
