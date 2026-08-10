import type { HelpMetaItem } from "@triliumnext/commons";
import becca from "@triliumnext/core/src/becca/becca.js";
import { load } from "@triliumnext/core/src/becca/becca_loader.js";
import blobService from "@triliumnext/core/src/services/blob.js";
import { getContext } from "@triliumnext/core/src/services/context.js";
import { HELP_ASSET_TOKEN, initInAppHelp } from "@triliumnext/core/src/services/in_app_help.js";
import searchService from "@triliumnext/core/src/services/search/services/search.js";
import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import NodejsInAppHelpProvider from "../src/in_app_help_provider.js";

/**
 * Exercises the in-app help against the artifacts that actually ship — the tree and content
 * `edit-docs` writes into `src/assets/help`. The unit tests around the provider and the injection
 * use stubs; this is the check that the real files still add up to a working help subtree.
 */
describe("in-app help (shipped artifacts)", () => {
    const provider = new NodejsInAppHelpProvider();
    const meta = provider.getHelpHiddenSubtreeData() as HelpMetaItem[];

    beforeAll(() => {
        initInAppHelp(provider);
        getContext().init(() => load());
    });

    it("injects every page of the shipped tree under _help", () => {
        expect(meta.length).toBeGreaterThan(0);

        for (const item of flatten(meta)) {
            const note = becca.getNote(item.id);
            expect(note, `help note ${item.id} ("${item.title}") is missing from becca`).toBeTruthy();
            expect(note?.isVirtual).toBe(true);
            expect(note?.title).toBe(item.title);
        }
    });

    it("serves the content of every page that ships one, through becca and the blob route", () => {
        const pages = flatten(meta).filter((item) => item.source);
        expect(pages.length).toBeGreaterThan(0);

        for (const page of pages) {
            const content = String(becca.getNoteOrThrow(page.id).getContent());
            expect(content, `help page ${page.id} ("${page.title}") has no content`).not.toBe("");

            const pojo = blobService.getBlobPojo("notes", page.id);
            expect(pojo.content).toBe(content);
            expect(pojo.isStubbed).toBe(false);
        }
    });

    it("points every image and attachment at a file the server serves", () => {
        // `getHelpAssetDir` serves these out of the markdown export in a source checkout, and the
        // build copies the same tree into the package.
        const assetRoot = path.resolve(__dirname, "../../../docs/User Guide");
        const missing: string[] = [];

        for (const page of flatten(meta).filter((item) => item.source)) {
            const html = String(becca.getNoteOrThrow(page.id).getContent());
            expect(html, `page ${page.id} still carries an unsubstituted asset placeholder`).not.toContain(HELP_ASSET_TOKEN);

            for (const match of html.matchAll(/(?:src|href)="([^"]*\/help\/[^"]*)"/g)) {
                const relative = decodeURIComponent(match[1].split("/help/")[1]);
                if (!fs.existsSync(path.join(assetRoot, relative))) {
                    missing.push(`${page.source} -> ${relative}`);
                }
            }
        }

        expect(missing).toEqual([]);
    });

    it("is searchable by its content, but only when the search asks for hidden notes", () => {
        // A phrase from the body of a page, not from any title.
        const query = "docker compose";

        const scoped = searchService.searchNotes(query, { includeHiddenNotes: true });
        expect(scoped.map((note) => note.noteId)).toContain("_help_rWX5eY045zbE");

        // The guide lives under _hidden, so an ordinary search still does not surface it — the
        // virtual pass makes the content matchable, not suddenly present in every result list.
        const ordinary = searchService.searchNotes(query, {});
        expect(ordinary.filter((note) => note.noteId.startsWith("_help"))).toEqual([]);
    });

    it("makes every page read-only", () => {
        for (const item of flatten(meta)) {
            expect(becca.getNoteOrThrow(item.id).isLabelTruthy("readOnly")).toBe(true);
        }
    });
});

function flatten(items: HelpMetaItem[], out: HelpMetaItem[] = []): HelpMetaItem[] {
    for (const item of items) {
        out.push(item);
        if (item.children) {
            flatten(item.children, out);
        }
    }
    return out;
}
