/**
 * Starts a dedicated Trilium instance for script development.
 *
 * On first run it initializes a fresh database (no demo content),
 * creates an ETAPI token and persists it to data/.etapi-token.
 * On subsequent runs it just boots the server.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { extname,join, resolve } from "node:path";

import { asNoteService,codeNoteId, deployScript, MIME_BY_EXT, parseScriptMeta, renderNoteId, SCRIPTS_NOTE_ID, transpile } from "./deploy";

// ── Environment — must be set before any server module is imported ──────────
const DATA_DIR = resolve(__dirname, "../data");
const TOKEN_PATH = join(DATA_DIR, ".etapi-token");
const PORT = 37842;

mkdirSync(DATA_DIR, { recursive: true });

process.env.TRILIUM_DATA_DIR = DATA_DIR;
process.env.TRILIUM_PORT = String(PORT);
process.env.TRILIUM_RESOURCE_DIR = resolve(__dirname, "../../server/src");
process.env.NODE_ENV = "development";
process.env.TRILIUM_ENV = "dev";

// ── Constants ───────────────────────────────────────────────────────────────
const SCRIPTS_DIR = resolve(__dirname, "../scripts");
const needsInit = !existsSync(join(DATA_DIR, "document.db"));

async function ensureTranslations() {
    const i18n = await import("@triliumnext/server/src/services/i18n.js");
    await i18n.initializeTranslations();
}

async function ensureDatabase() {
    if (!needsInit) return;

    console.log("No database found — creating a fresh instance…");

    const cls = (await import("@triliumnext/server/src/services/cls.js")).default;
    const sqlInit = (await import("@triliumnext/server/src/services/sql_init.js")).default;

    // createInitialDatabase must run inside CLS (it touches becca).
    await cls.init(async () => {
        await sqlInit.createInitialDatabase(/* skipDemoDb */ true);
    });

    console.log("Database created.");
}

async function ensureEtapiToken() {
    if (existsSync(TOKEN_PATH)) {
        const token = readFileSync(TOKEN_PATH, "utf-8").trim();
        console.log(`ETAPI token: ${token}`);
        return;
    }

    const cls = (await import("@triliumnext/server/src/services/cls.js")).default;
    const etapiTokens = (await import("@triliumnext/server/src/services/etapi_tokens.js")).default;

    const authToken: string = cls.init(() => {
        const { authToken } = etapiTokens.createToken("script-deployer");
        return authToken;
    });

    writeFileSync(TOKEN_PATH, `${authToken  }\n`);
    console.log(`ETAPI token created and saved to ${TOKEN_PATH}`);
    console.log(`ETAPI token: ${authToken}`);
}

async function ensureScriptsFolder() {
    const becca = (await import("@triliumnext/server/src/becca/becca.js")).default;
    if (becca.notes[SCRIPTS_NOTE_ID]) return;

    const cls = (await import("@triliumnext/server/src/services/cls.js")).default;
    const notesService = (await import("@triliumnext/server/src/services/notes.js")).default;

    cls.init(() => {
        notesService.createNewNote({
            noteId: SCRIPTS_NOTE_ID,
            parentNoteId: "root",
            title: "Scripts",
            type: "doc",
            content: "",
        });
    });

    console.log("Created 'Scripts' folder note.");
}

async function deployScripts() {
    const files = readdirSync(SCRIPTS_DIR).filter((f) => MIME_BY_EXT[extname(f)]);
    if (!files.length) {
        console.log("No scripts to deploy.");
        return;
    }

    const becca = (await import("@triliumnext/server/src/becca/becca.js")).default;
    const cls = (await import("@triliumnext/server/src/services/cls.js")).default;
    const notesService = (await import("@triliumnext/server/src/services/notes.js")).default;

    console.log(`Deploying ${files.length} script(s)…`);

    for (const file of files) {
        const filePath = join(SCRIPTS_DIR, file);
        const source = readFileSync(filePath, "utf-8");
        const meta = parseScriptMeta(source, file);
        if (!meta) continue;

        const mime = MIME_BY_EXT[extname(file)]!;
        const content = transpile(source, file);

        cls.init(() => {
            const result = deployScript(meta, content, mime, becca, asNoteService(notesService));
            console.log(`  ${result.action === "created" ? "Created" : "Updated"}: ${result.title} (${result.codeNoteId})`);
        });
    }
}

function watchScripts() {
    // Debounce per file — editors can fire multiple events on a single save.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    watch(SCRIPTS_DIR, (_eventType, filename) => {
        if (!filename || !MIME_BY_EXT[extname(filename)]) return;

        if (timers.has(filename)) clearTimeout(timers.get(filename));
        timers.set(filename, setTimeout(() => {
            timers.delete(filename);
            syncFile(filename);
        }, 100));
    });

    async function syncFile(filename: string) {
        const filePath = join(SCRIPTS_DIR, filename);
        if (!existsSync(filePath)) return;

        const source = readFileSync(filePath, "utf-8");
        const meta = parseScriptMeta(source, filename);
        if (!meta) return;

        const noteId = codeNoteId(meta.id);

        const becca = (await import("@triliumnext/server/src/becca/becca.js")).default;
        const cls = (await import("@triliumnext/server/src/services/cls.js")).default;

        const note = becca.notes[noteId];
        if (!note) {
            console.log(`  [watch] ${filename}: note ${noteId} not found, restart to create.`);
            return;
        }

        const content = transpile(source, filename);

        cls.init(() => {
            note.setContent(content);
        });

        // For render scripts, trigger a refresh of all contexts viewing
        // the render note by injecting a client-side script via websocket.
        if (meta.type === "render") {
            const ws = (await import("@triliumnext/server/src/services/ws.js")).default;
            const renderId = renderNoteId(meta.id);
            ws.sendMessageToAllClients({
                type: "execute-script",
                script: `function({ renderId, title }) {
                    for (const ctx of api.getNoteContexts()) {
                        if (ctx.noteId === renderId) {
                            api.triggerEvent("refreshData", { ntxId: ctx.ntxId });
                            console.log("[script-deployer] refreshed", title, "in context", ctx.ntxId);
                        }
                    }
                }`,
                params: [{
                    renderId,
                    title: meta.title
                }],
                currentNoteId: noteId,
                originEntityName: "notes",
                originEntityId: noteId,
            });
        }

        console.log(`  [watch] Synced: ${meta.title}`);
    }

    console.log(`Watching ${SCRIPTS_DIR} for changes…`);
}

async function main() {
    await ensureTranslations();
    await ensureDatabase();
    await ensureEtapiToken();

    // Start the full HTTP server — this loads becca and makes the note
    // tree available for subsequent setup steps.
    const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
    await startTriliumServer();

    await ensureScriptsFolder();
    await deployScripts();
    watchScripts();

    console.log(`\nScript-deployer Trilium instance running on http://localhost:${PORT}`);
    console.log(`Token file: ${TOKEN_PATH}\n`);
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
