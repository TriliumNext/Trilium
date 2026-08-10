import type { HelpMetaItem } from "@triliumnext/commons";
import becca from "@triliumnext/core/src/becca/becca.js";
import { load } from "@triliumnext/core/src/becca/becca_loader.js";
import blobService from "@triliumnext/core/src/services/blob.js";
import { getContext } from "@triliumnext/core/src/services/context.js";
import { initInAppHelp } from "@triliumnext/core/src/services/in_app_help.js";
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
