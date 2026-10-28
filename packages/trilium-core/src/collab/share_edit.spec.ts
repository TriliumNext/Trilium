import { beforeEach, describe, expect, it, vi } from "vitest";

import optionService from "../services/options.js";
import SAttribute from "../share/shaca/entities/sattribute.js";
import shaca from "../share/shaca/shaca.js";
import { buildShareNote } from "../test/shaca_mocking.js";
import {
    buildEditPayload, EDIT_OPTION_OVERRIDES, getShareEditPolicy, hashShareEditPassword,
    verifyShareEditPassword
} from "./share_edit.js";

// scrypt runs in pure JS under the standalone suite and is far slower there.
if (typeof self !== "undefined") {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

describe("share edit policy", () => {
    beforeEach(() => {
        shaca.reset();
    });

    it("reads the policy from the note that owns #shareEdit, inherited by its subtree", () => {
        // Shaca caches a note's attributes on the first read, so each tree is labeled before it is read.
        buildShareNote({ id: "plain" });
        buildShareNote({ id: "open", children: [ { id: "openChild" } ] });
        addLabel("open", "shareEdit", "", true);
        const root = buildShareNote({ id: "root", children: [
            { id: "child", children: [ { id: "grandchild" } ] },
            { id: "closed", children: [ { id: "closedChild" } ] },
            { id: "openBranch" }
        ] });
        addLabel("root", "shareEdit", "", true);
        addLabel("root", "shareEditPassword", "salt$hash", true);
        addLabel("child", "shareAttachments", "", true);
        addLabel("closed", "shareEdit", "false", true);
        addLabel("openBranch", "shareEdit", "", true);
        addLabel("openBranch", "shareEditPassword", "", true);
        const grandchild = shaca.getNote("grandchild");

        expect(getShareEditPolicy(shaca.getNote("plain"))).toBeNull();
        // A grant holds the salt of the password's hash, new with every password, or `open`.
        expect(getShareEditPolicy(shaca.getNote("openChild"))).toEqual(
            { rootNoteId: "open", needsPassword: false, attachments: false, grantKey: "open" });
        expect(getShareEditPolicy(root)).toEqual(
            { rootNoteId: "root", needsPassword: true, attachments: false, grantKey: "salt" });
        expect(getShareEditPolicy(grandchild)).toEqual(
            { rootNoteId: "root", needsPassword: true, attachments: true, grantKey: "salt" });
        // An empty password opens a branch below a password-protected ancestor.
        expect(getShareEditPolicy(shaca.getNote("openBranch"))).toEqual({
            rootNoteId: "openBranch", needsPassword: false, attachments: false, grantKey: "open"
        });
        // A note closes its own subtree with #shareEdit=false.
        expect(getShareEditPolicy(shaca.getNote("closed"))).toBeNull();
        expect(getShareEditPolicy(shaca.getNote("closedChild"))).toBeNull();
        // The password stays out of what a visitor reads, as the share's credentials do.
        expect(grandchild.getAttributes("label", "shareEditPassword")).toEqual([]);
        expect(grandchild.getPojo().attributes.map((attr) => attr.name)).not.toContain("shareEditPassword");
        expect(grandchild.getSecretLabelValue("shareEditPassword")).toBe("salt$hash");
        expect(grandchild.getSecretLabelValue("shareAttachments")).toBeNull();
    });

    it("hashes a password with a salt of its own and verifies only that password", async () => {
        const stored = await hashShareEditPassword("letmein");
        const again = await hashShareEditPassword("letmein");

        expect(stored).toMatch(/^[^$]+\$[^$]+$/);
        expect(again).not.toBe(stored);
        expect(await verifyShareEditPassword("letmein", stored)).toBe(true);
        expect(await verifyShareEditPassword("letmeout", stored)).toBe(false);
        expect(await verifyShareEditPassword("letmein", null)).toBe(false);
        expect(await verifyShareEditPassword("letmein", "no-separator")).toBe(false);
    });

    it("builds the editor's payload from the note's rows, the editor options and the fixed ones", () => {
        const getOption = vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) =>
            name === "textNoteEditorType" ? "ckeditor-balloon" : name === "locale" ? "de" : null);
        buildShareNote({ id: "parent", children: [ { id: "edited", children: [ { id: "child" } ] } ] });
        const edited = shaca.getNote("edited");

        const payload = buildEditPayload(edited, (note) => note.noteId !== "child");

        expect(payload.notes.map((note) => note.noteId)).toEqual([ "edited" ]);
        expect(payload.parentNoteId).toBe("parent");
        expect(payload.assetPath).toMatch(/^\.\.\/assets\/v/);
        expect(payload.options).toMatchObject({ ...EDIT_OPTION_OVERRIDES, locale: "de", codeBlockTheme: null });
        expect(payload.options).not.toHaveProperty("llmProviders");
        getOption.mockRestore();
    });
});

function addLabel(noteId: string, name: string, value: string, isInheritable = false) {
    return new SAttribute([ `${noteId}-${name}`, noteId, "label", name, value, isInheritable, 0 ]);
}
