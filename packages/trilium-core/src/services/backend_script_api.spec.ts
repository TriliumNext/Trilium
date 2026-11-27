import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import beccaLoader from "../becca/becca_loader.js";
import type BNote from "../becca/entities/bnote.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import appInfo from "./app_info.js";
import BackendScriptApi, { type Api } from "./backend_script_api.js";
import { getBackup } from "./backup.js";
import config from "./config.js";
import { getContext } from "./context.js";
import zipExportService from "./export/zip.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import sql_init from "./sql_init.js";
import treeService from "./tree.js";
import ws from "./ws.js";

describe("BackendScriptApi.log", () => {
    beforeEach(() => {
        becca.reset();
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {}).mockClear();
    });

    it("sends the plain message string over the websocket", async () => {
        const startNote = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: ""
        });

        const api = new BackendScriptApi(startNote, { startNote });
        api.log("Hello world quickie.");

        await api.logSpacedUpdates[startNote.noteId].updateNowIfNecessary();

        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "api-log-messages",
                noteId: startNote.noteId,
                messages: ["Hello world quickie."]
            })
        );
    });
});

describe("BackendScriptApi.transactional", () => {
    beforeEach(() => becca.reset());

    it("runs the callback inside a transaction and returns its result", () => {
        const startNote = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        const api = new BackendScriptApi(startNote, { startNote });

        let executed = false;
        const result = api.transactional(() => {
            executed = true;
            return 42;
        });

        expect(executed).toBe(true);
        expect(result).toBe(42);
    });
});

describe("BackendScriptApi markdown conversion", () => {
    beforeEach(() => becca.reset());

    function makeApi() {
        const startNote = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        return new BackendScriptApi(startNote, { startNote });
    }

    it("htmlToMarkdown converts HTML to Markdown", () => {
        expect(makeApi().htmlToMarkdown("<p>This is <strong>bold</strong>.</p>")).toBe("This is **bold**.");
    });

    it("markdownToHtml converts Markdown to HTML", () => {
        expect(makeApi().markdownToHtml("This is **bold**.")).toContain("<strong>bold</strong>");
    });
});

describe("BackendScriptApi removed libraries", () => {
    beforeEach(() => becca.reset());

    function makeApi() {
        const startNote = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        return new BackendScriptApi(startNote, { startNote });
    }

    it("throws a migration hint whether cheerio is read from or called", () => {
        const api = makeApi();

        expect(() => (api.cheerio as any).load("<p></p>")).toThrow(/api\.htmlParser/);
        expect(() => (api.cheerio as any)("<p></p>")).toThrow(/api\.htmlParser/);
    });

    it("throws a migration hint whether axios is read from or called", () => {
        const api = makeApi();

        expect(() => (api.axios as any).get("https://example.com")).toThrow(/fetch\(\)/);
        expect(() => (api.axios as any)("https://example.com")).toThrow(/fetch\(\)/);
    });
});

describe("BackendScriptApi against the database", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
        // Earlier describes in this file reset becca to build notes by hand.
        getContext().init(() => {
            beccaLoader.load();
            hiddenSubtreeService.checkHiddenSubtree();
        });
    });

    afterEach(() => vi.restoreAllMocks());

    function makeApi(originEntity?: BNote) {
        const root = becca.getNoteOrThrow("root");
        return new BackendScriptApi(root, { startNote: root, originEntity });
    }

    it("reads entities, options and app details through the cache", () => {
        const api = makeApi();
        const root = becca.getNoteOrThrow("root");
        const branch = root.getParentBranches()[0];
        const option = becca.getOption("theme");

        expect(api.getInstanceName()).toBe(config.General.instanceName);
        expect(api.getNote("root")).toBe(root);
        expect(api.getBranch(branch.branchId ?? "")).toBe(branch);
        expect(api.getAttribute("missing")).toBeFalsy();
        expect(api.getAttachment("missing")).toBeFalsy();
        expect(api.getRevision("missing")).toBeFalsy();
        expect(api.getEtapiToken("missing")).toBeFalsy();
        expect(api.getEtapiTokens()).toEqual(becca.getEtapiTokens());
        expect(api.getOption("theme")).toBe(option);
        expect(api.getOptions()).toEqual(expect.arrayContaining([ option ]));
        expect(api.getAppInfo()).toBe(appInfo);
    });

    it("searches including archived notes and outside the hoisted note unless told otherwise", () => {
        const api = makeApi();
        const { note } = getContext().init(() => api.createTextNote("root", "Searchable zebracorn", "<p>x</p>"));
        getContext().init(() => note.setLabel("archived"));

        expect(asScript(api).searchForNotes("zebracorn")).toEqual([ note ]);
        expect(asScript(api).searchForNote("zebracorn")).toBe(note);
        expect(api.searchForNotes("zebracorn", { includeArchivedNotes: false, ignoreHoistedNote: false })).toEqual([]);
        expect(asScript(api).searchForNote("no-such-zebracorn-anywhere")).toBeNull();
    });

    it("creates text, data and parent-typed notes, with attributes", () => {
        const api = makeApi();

        getContext().init(() => {
            const text = asScript(api).createTextNote("root", "Text").note;
            expect(text.type).toBe("text");
            expect(text.getContent()).toBe("");

            const data = api.createDataNote("root", "Data", { answer: 42 }).note;
            expect(data.mime).toBe("application/json");
            expect(JSON.parse(String(data.getContent()))).toEqual({ answer: 42 });
            expect(JSON.parse(String(asScript(api).createDataNote("root", "Empty data").note.getContent()))).toEqual({});

            const codeParent = api.createNewNote({ parentNoteId: "root", title: "Code", type: "code", mime: "text/x-python", content: "" }).note;
            const inherited = api.createNote(codeParent.noteId, "Child", "print(1)", {
                attributes: [
                    { type: "label", name: "lang", value: "py" },
                    { type: "relation", name: "seeAlso", value: "root", isInheritable: true }
                ]
            }).note;
            expect(inherited.type).toBe("code");
            expect(inherited.mime).toBe("text/x-python");
            expect(inherited.getContent()).toBe("print(1)");
            expect(inherited.getOwnedLabelValue("lang")).toBe("py");
            expect(inherited.getOwnedRelation("seeAlso")?.isInheritable).toBe(true);

            const json = api.createNote("root", "Json", { a: 1 } as unknown as string, { json: true }).note;
            expect(json.mime).toBe("application/json");
            expect(JSON.parse(String(json.getContent()))).toEqual({ a: 1 });
            expect(JSON.parse(String(api.createNote("root", "Json2", "", { json: true }).note.getContent()))).toEqual({});

            const plain = asScript(api).createNote("root", "Plain").note;
            expect(plain.mime).toBe("text/html");
            expect(plain.getContent()).toBe("");

            expect(() => asScript(api).createNote("missing-parent", "x")).toThrow(/Unable to find parent note/);
        });
    });

    it("delegates sorting, export and backups to their services", async () => {
        const api = makeApi();
        const sortNotes = vi.spyOn(treeService, "sortNotes").mockImplementation(() => {});
        const exportToZipFile = vi.spyOn(zipExportService, "exportToZipFile").mockResolvedValue(undefined);
        const backupNow = vi.spyOn(getBackup(), "backupNow").mockResolvedValue("/backups/spec.db");

        asScript(api).sortNotes("root");
        api.sortNotes("root", { sortBy: "dateCreated", reverse: true, foldersFirst: true });
        expect(sortNotes.mock.calls).toEqual([
            [ "root", "title", false, false ],
            [ "root", "dateCreated", true, true ]
        ]);

        await api.exportSubtreeToZipFile("root", "markdown", "/tmp/out.zip");
        expect(exportToZipFile).toHaveBeenCalledWith("root", "markdown", "/tmp/out.zip");
        await expect(api.backupNow("spec")).resolves.toBe("/backups/spec.db");
        expect(backupNow).toHaveBeenCalledWith("spec");
    });

    it("logs without a start note only to the backend log", () => {
        const root = becca.getNoteOrThrow("root");
        const api = new BackendScriptApi(root, {});
        vi.spyOn(console, "info").mockImplementation(() => {});

        api.log("no start note");
        expect(api.logMessages).toEqual({});
    });

    it("sends frontend scripts with their parameters and origin", async () => {
        const send = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});

        await makeApi(becca.getNoteOrThrow("root")).runOnFrontend(function (x: number) {
            return x;
        } as unknown as () => void, [ 1, (y: number) => y ] as unknown as []);
        await asScript(makeApi()).runOnFrontend("() => 1", null);

        expect(send.mock.calls[0][0]).toMatchObject({
            type: "execute-script",
            script: expect.stringContaining("return x;"),
            params: [ 1, "!@#Function: (y) => y" ],
            startNoteId: "root",
            currentNoteId: "root",
            originEntityId: "root"
        });
        expect(send.mock.calls[1][0]).toMatchObject({ script: "() => 1", params: null, originEntityId: null });
    });

    describe("createOrUpdateLauncher", () => {
        type LauncherOptions = Parameters<ReturnType<typeof makeApi>["createOrUpdateLauncher"]>[0];
        const base: LauncherOptions = {
            id: "specLauncher", type: "note", title: "Spec launcher", isVisible: true,
            icon: "", keyboardShortcut: "", targetNoteId: "root", scriptNoteId: ""
        };

        it("validates its options", () => {
            const api = makeApi();
            const invalid: [ Record<string, string>, RegExp ][] = [
                [ { id: "" }, /ID is a mandatory/ ],
                [ { id: "ab!" }, /alphanumeric/ ],
                [ { type: "" }, /Launcher Type is a mandatory/ ],
                [ { type: "spacer" }, /Given launcher type 'spacer'/ ],
                [ { title: "  " }, /Title is a mandatory/ ],
                [ { targetNoteId: "" }, /targetNoteId is mandatory/ ],
                [ { type: "script" }, /scriptNoteId is mandatory/ ],
                [ { type: "customWidget" }, /widgetNoteId is mandatory/ ]
            ];

            for (const [ override, error ] of invalid) {
                expect(() => api.createOrUpdateLauncher({ ...base, ...override } as LauncherOptions)).toThrow(error);
            }
        });

        it("creates a launcher, then updates its title, place, target and labels", () => {
            const api = makeApi();

            getContext().init(() => {
                const { note } = api.createOrUpdateLauncher({ ...base, icon: "bx-star", keyboardShortcut: "ctrl+alt+l" });
                expect(note.noteId).toBe("al_specLauncher");
                expect(note.title).toBe("Spec launcher");
                expect(note.getParentNotes().map((p) => p.noteId)).toEqual([ "_lbVisibleLaunchers" ]);
                expect(note.getRelationValue("target")).toBe("root");
                expect(note.getOwnedLabelValue("iconClass")).toBe("bx bx-star");
                expect(note.getOwnedLabelValue("keyboardShortcut")).toBe("ctrl+alt+l");

                const script = api.createOrUpdateLauncher({ ...base, type: "script", title: "Renamed", isVisible: false, scriptNoteId: "root" }).note;
                expect(script).toBe(note);
                expect(note.title).toBe("Renamed");
                expect(note.getParentNotes().map((p) => p.noteId)).toEqual([ "_lbAvailableLaunchers" ]);
                expect(note.getRelationValue("script")).toBe("root");
                expect(note.hasOwnedLabel("iconClass")).toBe(false);
                expect(note.hasOwnedLabel("keyboardShortcut")).toBe(false);

                api.ensureNoteIsPresentInParent(note.noteId, "_lbVisibleLaunchers", "");
                api.createOrUpdateLauncher({ ...base, type: "customWidget", title: "Renamed", isVisible: false, widgetNoteId: "root" });
                expect(note.getParentNotes().map((p) => p.noteId).sort()).toEqual([ "_lbAvailableLaunchers", "_lbVisibleLaunchers" ]);
                expect(note.getRelationValue("widget")).toBe("root");
            });
        });
    });
});

/**
 * The script API as a JavaScript script calls it, leaving trailing parameters to the defaults that
 * the implementation gives them.
 */
interface ScriptCalls {
    searchForNotes(query: string): ReturnType<Api["searchForNotes"]>;
    searchForNote(query: string): ReturnType<Api["searchForNote"]>;
    createTextNote(parentNoteId: string, title: string): ReturnType<Api["createTextNote"]>;
    createDataNote(parentNoteId: string, title: string): ReturnType<Api["createDataNote"]>;
    createNote(parentNoteId: string, title: string): ReturnType<Api["createNote"]>;
    sortNotes(parentNoteId: string): void;
    runOnFrontend(script: string, params: null): Promise<void>;
}

function asScript(api: Api) {
    return api as unknown as ScriptCalls;
}
