import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as i18n from "../../services/i18n";
import { getConfig, initConfig } from "../../services/config";
import { getSql } from "../../services/sql/index";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core options routes through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

function getOptionValue(name: string): string | null {
    return getSql().getValue<string | null>("SELECT value FROM options WHERE name = ?", [name]);
}

describe("Options API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the allowed option map, isPasswordSet and skips read-only fields by default", async () => {
        const res = await api.get<Record<string, string>>("/api/options");
        expect(res.status).toBe(200);
        // an allowed option is present
        expect(res.body.theme).toBeDefined();
        // a non-allowed option is omitted
        expect(res.body.passwordVerificationHash).toBeUndefined();
        // password is set in the demo fixture
        expect(res.body.isPasswordSet).toBe("true");
        // read-only branch not taken with the default (empty) config
        expect(res.body.databaseReadonly).toBeUndefined();
    });

    it("applies the read-only config branch", async () => {
        const original = getConfig();
        initConfig({ ...original, General: { ...original.General, readOnly: true } });
        try {
            const res = await api.get<Record<string, string>>("/api/options");
            expect(res.body.databaseReadonly).toBe("true");
            expect(res.body.autoReadonlySizeText).toBe("0");
            expect(res.body.autoReadonlySizeCode).toBe("0");
        } finally {
            initConfig(original);
        }
    });

    it("updates a single allowed option via PUT /api/options/:name/:value", async () => {
        const res = await api.put("/api/options/zoomFactor/1.5");
        expect(res.status).toBe(204);
        expect(getOptionValue("zoomFactor")).toBe("1.5");
    });

    it("rejects a not-allowed single option with a ValidationError (400)", async () => {
        const res = await api.put("/api/options/passwordVerificationHash/hacked");
        expect(res.status).toBe(400);
    });

    it("runs changeLanguage when updating the locale option", async () => {
        const changeLanguage = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as never);
        const res = await api.put("/api/options/locale/de");
        expect(res.status).toBe(204);
        expect(changeLanguage).toHaveBeenCalledWith("de");
        expect(getOptionValue("locale")).toBe("de");
    });

    it("covers the isAllowed prefix/suffix branches", async () => {
        // starts with keyboardShortcuts
        expect((await api.put("/api/options/keyboardShortcutsFoo/x")).status).toBe(204);
        // ends with Collapsed
        expect((await api.put("/api/options/somethingCollapsed/y")).status).toBe(204);
        // starts with hideArchivedNotes
        expect((await api.put("/api/options/hideArchivedNotes_main/true")).status).toBe(204);
        expect(getOptionValue("keyboardShortcutsFoo")).toBe("x");
    });

    it("updates multiple options via PUT /api/options (map body)", async () => {
        const res = await api.put("/api/options", { body: { mainFontSize: "120", treeFontSize: "90" } });
        expect(res.status).toBe(204);
        expect(getOptionValue("mainFontSize")).toBe("120");
        expect(getOptionValue("treeFontSize")).toBe("90");
    });

    it("runs changeLanguage when the locale is present in the map body", async () => {
        const changeLanguage = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as never);
        const res = await api.put("/api/options", { body: { locale: "fr" } });
        expect(res.status).toBe(204);
        expect(changeLanguage).toHaveBeenCalledWith("fr");
    });

    it("rolls back the batch and errors (500) when a not-allowed option is in the map body", async () => {
        const before = getOptionValue("mainFontSize");
        const res = await api.put("/api/options", {
            body: { mainFontSize: "200", passwordVerificationHash: "nope" }
        });
        expect(res.status).toBe(500);
        // earlier option in the same batch was rolled back
        expect(getOptionValue("mainFontSize")).toBe(before);
    });

    it("returns user themes, deriving the value from title when appTheme has no value", async () => {
        // theme with an explicit appTheme value
        const withValue = await api.post<{ note: { noteId: string } }>(
            "/api/notes/root/children?target=into",
            { body: { title: "Theme A", type: "text", content: "" } }
        );
        await api.put(`/api/notes/${withValue.body.note.noteId}/set-attribute`, {
            body: { type: "label", name: "appTheme", value: "my-theme" }
        });

        // theme with appTheme but no value -> derived from title
        const noValue = await api.post<{ note: { noteId: string } }>(
            "/api/notes/root/children?target=into",
            { body: { title: "Theme B!!", type: "text", content: "" } }
        );
        await api.put(`/api/notes/${noValue.body.note.noteId}/set-attribute`, {
            body: { type: "label", name: "appTheme", value: "" }
        });

        const res = await api.get<Array<{ val: string; title: string; noteId: string }>>(
            "/api/options/user-themes"
        );
        expect(res.status).toBe(200);
        const withValueEntry = res.body.find((t) => t.noteId === withValue.body.note.noteId);
        const noValueEntry = res.body.find((t) => t.noteId === noValue.body.note.noteId);
        expect(withValueEntry?.val).toBe("my-theme");
        // "Theme B!!" -> non-alphanumerics replaced with "-"
        expect(noValueEntry?.val).toBe("theme-b--");
    });
});
