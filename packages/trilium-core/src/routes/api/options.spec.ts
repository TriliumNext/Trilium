import type { UserFont } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as i18n from "../../services/i18n";
import optionService from "../../services/options";
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

/** Forces the stored `syncServerHost` option, leaving every other option reading from the fixture. */
function mockSyncServerHost(syncServerHost: string) {
    const originalGetOption = optionService.getOption.bind(optionService);
    const originalGetOptionOrNull = optionService.getOptionOrNull.bind(optionService);
    vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) =>
        name === "syncServerHost" ? syncServerHost : originalGetOptionOrNull(name)
    );
    return vi.spyOn(optionService, "getOption").mockImplementation((name) =>
        name === "syncServerHost" ? syncServerHost : originalGetOption(name)
    );
}

/** Creates a file note carrying a `#customFont` label and returns its note ID. */
async function createFontNote(title: string): Promise<string> {
    const created = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
        body: { title, type: "file", mime: "font/woff2", content: "wOF2" }
    });
    const { noteId } = created.body.note;
    await api.put(`/api/notes/${noteId}/set-attribute`, {
        body: { type: "label", name: "customFont", value: "" }
    });
    return noteId;
}

/** Creates a code note carrying a `#run` label and returns its note ID. */
async function createCodeNote(title: string, mime: string): Promise<string> {
    const created = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
        body: { title, type: "code", mime, content: "api.log('hi');" }
    });
    const { noteId } = created.body.note;
    await api.put(`/api/notes/${noteId}/set-attribute`, {
        body: { type: "label", name: "run", value: "backendStartup" }
    });
    return noteId;
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

    it("exposes the read-only security config flags", async () => {
        const original = getConfig();
        initConfig({
            ...original,
            Security: {
                ...original.Security,
                backendScriptingEnabled: true,
                sqlConsoleEnabled: true,
                allowLanAccess: true
            }
        });
        try {
            const res = await api.get<Record<string, string>>("/api/options");
            expect(res.body.backendScriptingEnabled).toBe("true");
            expect(res.body.sqlConsoleEnabled).toBe("true");
            expect(res.body.allowLanAccess).toBe("true");
        } finally {
            initConfig(original);
        }
    });

    describe("the effective sync server", () => {
        it("reports the normalized stored host, with credentials removed", async () => {
            mockSyncServerHost(" https://user:secret@sync.example.com//path/ ");

            const res = await api.get<Record<string, string>>("/api/options");
            expect(res.body.effectiveSyncServerHost).toBe("https://sync.example.com/path");
            expect(res.body.syncServerHostOverridden).toBe("false");
        });

        it("removes credentials from malformed and schemeless hosts, keeping the rest for diagnostics", async () => {
            const malformed = mockSyncServerHost("https://user:secret@host:99999");
            expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost)
                .toBe("https://host:99999");

            malformed.mockRestore();
            const schemeless = mockSyncServerHost("user:secret@sync.example.com");
            expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost)
                .toBe("sync.example.com");

            schemeless.mockRestore();
            mockSyncServerHost("not a URL");
            expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost)
                .toBe("not a URL");
        });

        it("keeps at signs that are not URL credentials", async () => {
            mockSyncServerHost("https://sync.example.com/path@name?recipient=user@example.com");

            const res = await api.get<Record<string, string>>("/api/options");
            expect(res.body.effectiveSyncServerHost)
                .toBe("https://sync.example.com/path@name?recipient=user@example.com");
        });

        it("is empty when no host is configured", async () => {
            const emptyHost = mockSyncServerHost("");
            expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost).toBe("");

            emptyHost.mockRestore();
            mockSyncServerHost("   ");
            expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost).toBe("");
        });

        it("prefers the config override over a stale or empty stored host, and flags it", async () => {
            const original = getConfig();
            initConfig({ ...original, Sync: { ...original.Sync, syncServerHost: "https://override.example.com/" } });
            try {
                const stale = mockSyncServerHost("https://stored.example.com");
                const overridden = await api.get<Record<string, string>>("/api/options");
                expect(overridden.body.effectiveSyncServerHost).toBe("https://override.example.com");
                expect(overridden.body.syncServerHostOverridden).toBe("true");

                stale.mockRestore();
                mockSyncServerHost("");
                expect((await api.get<Record<string, string>>("/api/options")).body.effectiveSyncServerHost)
                    .toBe("https://override.example.com");
            } finally {
                initConfig(original);
            }
        });

        it("is empty but still flagged when the config override disables sync", async () => {
            const original = getConfig();
            initConfig({ ...original, Sync: { ...original.Sync, syncServerHost: "disabled" } });
            try {
                mockSyncServerHost("https://stored.example.com");

                const res = await api.get<Record<string, string>>("/api/options");
                expect(res.body.effectiveSyncServerHost).toBe("");
                expect(res.body.syncServerHostOverridden).toBe("true");
            } finally {
                initConfig(original);
            }
        });
    });

    it("flags backend scripts, ignoring #run labels on frontend scripts", async () => {
        expect((await api.get<Record<string, string>>("/api/options")).body.hasUserBackendScripts).toBe("false");

        // #run also appears on frontend scripts, so only the backend MIME type counts.
        await createCodeNote("Frontend script", "application/javascript;env=frontend");
        expect((await api.get<Record<string, string>>("/api/options")).body.hasUserBackendScripts).toBe("false");

        await createCodeNote("Backend script", "application/javascript;env=backend");
        expect((await api.get<Record<string, string>>("/api/options")).body.hasUserBackendScripts).toBe("true");
    });

    it("accepts write-only secrets but reports them only as a boolean flag", async () => {
        expect((await api.put("/api/options/openaiApiKey/sk-secret-value")).status).toBe(204);
        // openNoteContexts skips the logging branch entirely
        expect((await api.put("/api/options/openNoteContexts/%5B%5D")).status).toBe(204);

        const res = await api.get<Record<string, string>>("/api/options");
        expect(res.body.openaiApiKey).toBeUndefined();
        expect(res.body.isOpenaiApiKeySet).toBe("true");
        // the other secret was never written
        expect(res.body.isAnthropicApiKeySet).toBe("false");
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

    it("refuses to let the security flags be written, and keeps them out of the database", async () => {
        // These two decide whether backend scripts and the SQL console run at all, and they come
        // from a file no route can reach: config.ini on a server, security.json in the desktop's
        // data directory, a locked OPFS file in standalone. Making either of them an option would
        // put the first behind the second — a script granted the SQL console could `UPDATE
        // options` its way to backend scripting, without the user being asked.
        for (const name of [ "backendScriptingEnabled", "sqlConsoleEnabled" ]) {
            expect((await api.put(`/api/options/${name}/true`)).status).toBe(400);
            // The map form rolls the whole batch back rather than validating up front, so this is
            // the 500 the surrounding tests describe — either way nothing is written.
            expect((await api.put("/api/options", { body: { [name]: "true" } })).status).toBe(500);
            // No row at all, which the two SQL providers report differently.
            expect(getOptionValue(name) ?? null).toBeNull();
        }

        // The route reports them from the config it was started with, so what a write would have
        // to reach is somewhere the API does not go.
        const res = await api.get<Record<string, string>>("/api/options");
        expect(res.body.backendScriptingEnabled).toBe("false");
        expect(res.body.sqlConsoleEnabled).toBe("false");
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

    it("returns each font note by id, named by its title", async () => {
        const noteId = await createFontNote("Iosevka");

        const res = await api.get<UserFont[]>("/api/options/user-fonts");
        expect(res.status).toBe(200);

        // The id an option points at, the name the picker offers it under, and the version the
        // request for its bytes carries.
        const entry = res.body.find((font) => font.noteId === noteId);
        expect(entry?.title).toBe("Iosevka");
        expect(entry?.blobId).toBeTruthy();
    });
});
