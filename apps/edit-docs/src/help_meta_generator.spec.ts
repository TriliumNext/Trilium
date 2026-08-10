import type { HelpMetaItem } from "@triliumnext/commons";
import type { NoteMeta } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import { buildHelpMeta } from "./help_meta_generator.js";

const BASE_URL = "https://docs.triliumnotes.org";

/** Wraps the given notes in a "User Guide" export root, mirroring the real markdown export. */
function metaFileOf(children: NoteMeta[], rootAttributes: NoteMeta["attributes"] = []): { formatVersion: number; appVersion: string; files: NoteMeta[] } {
    const root: NoteMeta = {
        isClone: false, noteId: "root", notePath: ["root"], title: "User Guide",
        notePosition: 1, prefix: null, isExpanded: false, type: "text", mime: "text/html",
        attributes: rootAttributes, format: "markdown", attachments: [],
        dataFileName: "User Guide.md", dirFileName: "User Guide", children
    };
    return { formatVersion: 2, appVersion: "0.103.0", files: [root] };
}

const labelOf = (item: HelpMetaItem | undefined, name: string) =>
    item?.attributes?.find((a) => a.name === name)?.value;

describe("buildHelpMeta", () => {
    it("resolves structure, icons and content sources", () => {
        const page: NoteMeta = {
            isClone: false, noteId: "text1", title: "Text", type: "text", mime: "text/html",
            attributes: [{ type: "label", name: "iconClass", value: "bx bx-star", isInheritable: false, position: 10 }],
            format: "markdown", dataFileName: "Text.md", children: []
        };
        const folder: NoteMeta = {
            isClone: false, noteId: "types", title: "Note Types", type: "text", mime: "text/html",
            attributes: [], format: "markdown", dirFileName: "Note Types", children: [page]
        };

        const items = buildHelpMeta(metaFileOf([folder]));
        const folderItem = items[0];
        const pageItem = folderItem?.children?.[0];

        // A note with no data file of its own is a folder, and carries no source.
        expect(folderItem?.id).toBe("_help_types");
        expect(folderItem?.type).toBe("book");
        expect(folderItem?.source).toBeUndefined();
        expect(labelOf(folderItem, "iconClass")).toBe("bx bx-folder");

        // Sources are relative to the export directory, which already is the root note's folder,
        // so the root contributes exactly one path segment.
        expect(pageItem?.id).toBe("_help_text1");
        expect(pageItem?.type).toBe("text");
        expect(pageItem?.source).toBe("User Guide/Note Types/Text.md");
        expect(labelOf(pageItem, "iconClass")).toBe("bx bx-star");
    });

    it("resolves a clone's icon and source to the primary occurrence", () => {
        // The same note is placed under two folders: a primary occurrence (isClone:false) carrying
        // a custom icon and the real file, and a clone (isClone:true) with no attributes and a
        // ".clone" data file. Both are the same note, so both must describe it identically —
        // otherwise the clone would point at a file that only exists to satisfy the export.
        const primary: NoteMeta = {
            isClone: false, noteId: "nix", title: "Nix flake", type: "text", mime: "text/html",
            attributes: [{ type: "label", name: "iconClass", value: "bx bxl-tux", isInheritable: false, position: 10 }],
            format: "markdown", dataFileName: "Nix flake.md", children: []
        };
        const clone: NoteMeta = {
            isClone: true, noteId: "nix", title: "Nix flake", type: "text", mime: "text/html",
            format: "markdown", dataFileName: "Nix flake.clone.md", children: []
        };
        const desktop: NoteMeta = {
            isClone: false, noteId: "desktop", title: "Desktop Installation", type: "text", mime: "text/html",
            attributes: [], format: "markdown", dirFileName: "Desktop Installation", children: [primary]
        };
        const server: NoteMeta = {
            isClone: false, noteId: "server", title: "Server Installation", type: "text", mime: "text/html",
            attributes: [], format: "markdown", dirFileName: "Server Installation", children: [clone]
        };

        const items = buildHelpMeta(metaFileOf([desktop, server]));
        const primaryItem = items.find((i) => i.id === "_help_desktop")?.children?.[0];
        const cloneItem = items.find((i) => i.id === "_help_server")?.children?.[0];

        expect(primaryItem?.id).toBe("_help_nix");
        expect(cloneItem?.id).toBe("_help_nix");
        expect(labelOf(cloneItem, "iconClass")).toBe("bx bxl-tux");
        expect(cloneItem?.source).toBe("User Guide/Desktop Installation/Nix flake.md");
        expect(cloneItem?.source).toBe(primaryItem?.source);
    });

    it("derives docUrl from the share alias chain, and only when a base URL is given", () => {
        const page: NoteMeta = {
            isClone: false, noteId: "highlights", title: "Feature Highlights", type: "text", mime: "text/html",
            attributes: [{ type: "label", name: "shareAlias", value: "feature-highlights", isInheritable: false, position: 10 }],
            format: "markdown", dataFileName: "Feature Highlights.md", children: []
        };
        const rootAlias: NoteMeta["attributes"] = [
            { type: "label", name: "shareAlias", value: "user-guide", isInheritable: false, position: 10 }
        ];

        const withBase = buildHelpMeta(metaFileOf([page], rootAlias), BASE_URL);
        expect(labelOf(withBase[0], "docUrl")).toBe("https://docs.triliumnotes.org/user-guide/feature-highlights");

        const withoutBase = buildHelpMeta(metaFileOf([page], rootAlias));
        expect(labelOf(withoutBase[0], "docUrl")).toBeUndefined();
    });

    it("keeps web views pointing at the online docs and gives them no source", () => {
        const embedded: NoteMeta = {
            isClone: false, noteId: "embedded", title: "Embedded", type: "webView", mime: "",
            attributes: [{ type: "label", name: "webViewSrc", value: "/user-guide/embedded", isInheritable: false, position: 10 }],
            format: "markdown", dataFileName: "Embedded.md", children: []
        };

        const items = buildHelpMeta(metaFileOf([embedded]), BASE_URL);

        expect(items[0]?.type).toBe("webView");
        expect(items[0]?.source).toBeUndefined();
        // Root-relative sources are stored that way in the notes; the docs origin is applied here.
        expect(labelOf(items[0], "webViewSrc")).toBe("https://docs.triliumnotes.org/user-guide/embedded");
    });

    it("keeps the mime of code notes so their content is not treated as markdown", () => {
        const script: NoteMeta = {
            isClone: false, noteId: "script", title: "Example", type: "code", mime: "application/javascript;env=backend",
            attributes: [], format: "markdown", dataFileName: "Example.js", children: []
        };

        const items = buildHelpMeta(metaFileOf([script]));

        expect(items[0]?.type).toBe("code");
        expect(items[0]?.mime).toBe("application/javascript;env=backend");
        expect(items[0]?.source).toBe("User Guide/Example.js");
    });

    it("hides notes that are hidden from the share tree", () => {
        const hidden: NoteMeta = {
            isClone: false, noteId: "hidden", title: "Features", type: "text", mime: "text/html",
            attributes: [{ type: "label", name: "shareHiddenFromTree", value: "", isInheritable: false, position: 10 }],
            format: "markdown", dirFileName: "Features", children: []
        };

        expect(buildHelpMeta(metaFileOf([hidden]))).toHaveLength(0);
    });

    it("returns nothing when the export has no files", () => {
        expect(buildHelpMeta({ formatVersion: 2, appVersion: "0.103.0", files: undefined as never })).toEqual([]);
    });
});
