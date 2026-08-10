import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./i18n.js", () => ({
    t: (key: string, options?: Record<string, unknown>) => translate(key, options)
}));
vi.mock("./syntax_highlight.js", () => ({
    formatCodeBlocks: (arg: unknown) => formatCodeBlocksMock(arg)
}));
vi.mock("../widgets/type_widgets/text/read_only_helper.js", () => ({
    applyReferenceLinks: (arg: unknown) => applyReferenceLinksMock(arg)
}));

import en from "../translations/en/translation.json";
import renderDoc, { isDocName } from "./doc_renderer.js";

const formatCodeBlocksMock = vi.fn((_arg?: unknown) => {});
const applyReferenceLinksMock = vi.fn(async (_arg?: unknown) => {});

/** Resolves against the shipped English catalog, escaping interpolations the way i18next does. */
function translate(key: string, options?: Record<string, unknown>) {
    const entry = (en.doc_notes as Record<string, string>)[key.replace("doc_notes.", "")] ?? key;
    return entry.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
}

/** Builds a minimal FNote-like object with the given docName label. */
function fakeNote(docName: string | null) {
    return { getLabelValue: (name: string) => (name === "docName" ? docName : null) } as any;
}

describe("isDocName", () => {
    it("accepts every name the hidden subtree hands out", () => {
        // The names in use, from hidden_subtree.ts, hidden_subtree_launcherbar.ts and task_states.ts.
        for (const name of [
            "hidden", "share", "user_hidden", "task_state", "task_states", "system_state",
            "launchbar_intro", "launchbar_command_launcher", "launchbar_note_launcher",
            "launchbar_script_launcher", "launchbar_spacer", "launchbar_widget_launcher",
            "launchbar_quick_search", "launchbar_history_navigation"
        ]) {
            expect(isDocName(name), name).toBe(true);
        }
    });

    it("rejects anything else, so a label cannot name a page that was never shipped", () => {
        expect(isDocName("")).toBe(false);
        expect(isDocName("User Guide/Quick Start")).toBe(false);
        expect(isDocName("../etc/passwd")).toBe(false);
        expect(isDocName("HIDDEN")).toBe(false);
    });
});

describe("every shipped name has text, and every text is shipped", () => {
    it("matches the catalog exactly", () => {
        const inCatalog = Object.keys(en.doc_notes).sort();
        const inCode = inCatalog.filter(isDocName).sort();
        expect(inCode).toEqual(inCatalog);
    });
});

describe("renderDoc", () => {
    beforeEach(() => {
        formatCodeBlocksMock.mockClear();
        applyReferenceLinksMock.mockClear();
    });

    it("resolves with an empty container when the note has no docName", async () => {
        const $content = await renderDoc(fakeNote(null));
        expect($content.html()).toBe("");
        expect(formatCodeBlocksMock).not.toHaveBeenCalled();
    });

    it("resolves with an empty container and logs when the docName is not one of ours", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const $content = await renderDoc(fakeNote("../etc/passwd"));
        expect($content.html()).toBe("");
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown docName"));
        errorSpy.mockRestore();
    });

    it("renders the page and runs post-processing", async () => {
        const $content = await renderDoc(fakeNote("launchbar_quick_search"));

        expect($content.find("a").first().attr("href")).toBe("#root/_help_Ms1nauBra7gq");
        expect(formatCodeBlocksMock).toHaveBeenCalledTimes(1);
        expect(applyReferenceLinksMock).toHaveBeenCalledTimes(1);
    });

    it("interpolates a code example as text, so its markup is not parsed as markup", async () => {
        const $content = await renderDoc(fakeNote("launchbar_widget_launcher"));

        const $pre = $content.find("pre");
        expect($pre.text()).toContain(`const TPL = \`<div style="height: 53px; width: 53px;"></div>\`;`);
        // The example's own <div> must not have become an element of the page.
        expect($pre.find("div").length).toBe(0);
    });
});
