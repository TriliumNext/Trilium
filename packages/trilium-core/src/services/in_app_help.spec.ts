import { describe, expect, it } from "vitest";

import { EMPTY_BLOB_ID, type HelpBundle, type HiddenSubtreeItem } from "@triliumnext/commons";
import becca from "../becca/becca.js";
import { load } from "../becca/becca_loader.js";
import { ValidationError } from "../errors.js";
import blobService from "./blob.js";
import { getContext } from "./context.js";
import { getHelpHiddenSubtreeData, HELP_ASSET_TOKEN, InAppHelpProvider, initInAppHelp } from "./in_app_help.js";
import { getVirtualNoteAssets, getVirtualNoteProvider } from "./virtual_notes.js";

/** Minimal concrete provider standing in for the platform-specific implementations. */
class TestHelpProvider extends InAppHelpProvider {
    constructor(private data: HiddenSubtreeItem[], private content: HelpBundle = {}, private assetBase = "assets/help") {
        super();
    }

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return this.data;
    }

    getHelpContent(): HelpBundle {
        return this.content;
    }

    getHelpAssetBase(): string {
        return this.assetBase;
    }

    readAssets: string[] = [];

    async getHelpAsset(assetPath: string): Promise<Uint8Array | null> {
        this.readAssets.push(assetPath);
        return new Uint8Array([ assetPath.length ]);
    }
}

function reloadBecca() {
    getContext().init(() => load());
}

describe("in_app_help", () => {
    it("delegates getHelpHiddenSubtreeData to the registered provider", () => {
        // The server suite registers a real provider during initializeCore;
        // override it with a deterministic stub for this isolated fork.
        const data: HiddenSubtreeItem[] = [{ id: "_helpFoo", title: "Foo", type: "text" }];
        initInAppHelp(new TestHelpProvider(data));
        expect(getHelpHiddenSubtreeData()).toBe(data);
    });

    it("injects the help subtree as virtual notes under _hidden", () => {
        const data: HiddenSubtreeItem[] = [
            {
                id: "_helpStub",
                title: "Stub page",
                type: "doc",
                icon: "bx-file",
                attributes: [{ type: "label", name: "docName", value: "stub" }]
            }
        ];
        initInAppHelp(new TestHelpProvider(data));
        reloadBecca();

        const helpRoot = becca.getNoteOrThrow("_help");
        expect(helpRoot.isVirtual).toBe(true);
        expect(helpRoot.type).toBe("book");
        expect(helpRoot.getParentNotes().map((note) => note.noteId)).toEqual(["_hidden"]);

        const stub = becca.getNoteOrThrow("_helpStub");
        expect(stub.isVirtual).toBe(true);
        expect(stub.getParentNotes().map((note) => note.noteId)).toEqual(["_help"]);
        expect(stub.getLabelValue("docName")).toBe("stub");
        expect(stub.getLabelValue("iconClass")).toBe("bx bx-file");
    });

    it("serves page content from the provider, through becca and the blob route", () => {
        const data: HiddenSubtreeItem[] = [
            { id: "_helpPage", title: "Page", type: "text" },
            { id: "_helpBlank", title: "Blank", type: "text" }
        ];
        initInAppHelp(new TestHelpProvider(data, { _helpPage: "<p>Rendered</p>" }));
        reloadBecca();

        expect(becca.getNoteOrThrow("_helpPage").getContent()).toBe("<p>Rendered</p>");
        // A page the provider has no entry for reads as empty rather than failing.
        expect(becca.getNoteOrThrow("_helpBlank").getContent()).toBe("");

        // Virtual notes have no blobs row, so the route derives the POJO from the provider. The
        // blobId is content-derived, as for persisted notes, so the client change-detects it the
        // same way — and empty content yields the shared empty-blob id rather than looking like a
        // blob the sync server withheld.
        const page = blobService.getBlobPojo("notes", "_helpPage");
        expect(page.content).toBe("<p>Rendered</p>");
        expect(page.contentLength).toBe("<p>Rendered</p>".length);
        expect(page.isStubbed).toBe(false);

        const blank = blobService.getBlobPojo("notes", "_helpBlank");
        expect(blank.blobId).toBe(EMPTY_BLOB_ID);
        expect(blank.isStubbed).toBe(false);
        expect(page.blobId).not.toBe(blank.blobId);
    });

    it("substitutes the platform's asset location into the pages", () => {
        const page = `<img src="${HELP_ASSET_TOKEN}/User%20Guide/pic.png">`;
        initInAppHelp(new TestHelpProvider(
            [{ id: "_helpPage", title: "Page", type: "text" }],
            { _helpPage: page },
            "assets/v1.2.3/help"
        ));
        reloadBecca();

        // One bundle ships to every platform; where its images live is decided on read.
        expect(becca.getNoteOrThrow("_helpPage").getContent())
            .toBe(`<img src="assets/v1.2.3/help/User%20Guide/pic.png">`);
    });

    it("declares each picture and file a page references, at the URL its content carries", async () => {
        const page = `<img src="${HELP_ASSET_TOKEN}/User%20Guide/My%20pic.png">`
            + `<a href="${HELP_ASSET_TOKEN}/User%20Guide/api.dat">API</a>`
            + `<img src="${HELP_ASSET_TOKEN}/User%20Guide/My%20pic.png">`
            + `<a href="https://example.com/x.png">elsewhere</a>`;
        const provider = new TestHelpProvider(
            [{ id: "_helpPage", title: "Page", type: "text" }],
            { _helpPage: page },
            "assets/v1.2.3/help"
        );
        initInAppHelp(provider);
        reloadBecca();

        const assets = getVirtualNoteAssets("_helpPage");
        expect(assets.map(({ id, url, title, mime }) => ({ id, url, title, mime }))).toEqual([
            { id: "_helpPage_a1", url: "assets/v1.2.3/help/User%20Guide/My%20pic.png", title: "My pic.png", mime: "image/png" },
            { id: "_helpPage_a2", url: "assets/v1.2.3/help/User%20Guide/api.dat", title: "api.dat", mime: "application/octet-stream" }
        ]);
        const content = String(becca.getNoteOrThrow("_helpPage").getContent());
        expect(assets.every((asset) => content.includes(`"${asset.url}"`))).toBe(true);

        await assets[0].getContent();
        expect(provider.readAssets).toEqual([ "User Guide/My pic.png" ]);
    });

    it("makes every help page read-only, with no label the user could remove", () => {
        initInAppHelp(new TestHelpProvider([{ id: "_helpPage", title: "Page", type: "text" }]));
        reloadBecca();

        const page = becca.getNoteOrThrow("_helpPage");
        expect(becca.getNoteOrThrow("_help").isContentWritable()).toBe(false);
        expect(page.isContentWritable()).toBe(false);
        expect(page.hasLabel("readOnly")).toBe(false);
        expect(() => getContext().init(() => page.setContent("<p>edited</p>"))).toThrow(ValidationError);
    });

    it("unregisters the help provider when none is supplied", () => {
        initInAppHelp(undefined as unknown as InAppHelpProvider);
        expect(getHelpHiddenSubtreeData()).toEqual([]);
        expect(getVirtualNoteProvider("_help")).toBeNull();

        reloadBecca();
        expect(becca.getNote("_help")).toBeNull();
    });
});
