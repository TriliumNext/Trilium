/**
 * Keeps a single `copilot --acp` subprocess alive across chat turns.
 *
 * Spawning the CLI and creating a session is expensive — measured on Windows,
 * a cold turn pays ~785 ms to spawn and run `initialize` plus ~2.4 s for the
 * first `session/new` (it refreshes auth and fetches the model list), so the
 * agent only starts generating ~3.2 s after the user hits send. None of that
 * is model latency, and all of it repeats on every message when the client is
 * disposed at the end of each turn.
 *
 * ACP is designed for exactly this: one connection hosts many sessions, each
 * addressed by `sessionId`, and prompting is a method call on a session that
 * already exists. So the client is shared process-wide rather than pooled per
 * chat — a warm turn skips the spawn, the handshake *and* session creation
 * entirely.
 *
 * Lifetime: started on demand, reference-counted for the duration of each
 * turn, and reaped after {@link IDLE_TIMEOUT_MS} with no active turns so an
 * idle Trilium isn't holding an agent subprocess open forever. A client that
 * dies on its own evicts itself, so the next turn transparently starts a new
 * one.
 */

import { getLog } from "@triliumnext/core";

import { AcpClient } from "./acp_client.js";

/**
 * CLI arguments passed alongside `--acp`. These form the *primary* security
 * boundary; the permission callback is a fail-closed backstop.
 *   - `--allow-tool=trilium` auto-approves every tool from our "trilium" MCP
 *     server, so note tools run without a permission round-trip (and without
 *     relying on us recognizing them — the CLI presents MCP tool calls with
 *     opaque IDs and human-friendly titles that don't embed the server name).
 *   - `--deny-tool` on each built-in file/shell/network tool guarantees they
 *     can never run even if a future CLI build changed the permission-prompt
 *     defaults. The agent's only capability surface is Trilium's note tools.
 *   - `--no-custom-instructions` keeps any AGENTS.md/copilot-instructions.md in
 *     an enclosing directory out of the notes chat.
 *   - `--no-auto-update` keeps the pinned binary from mutating under us.
 */
export const COPILOT_ACP_ARGS = [
    "--allow-tool=trilium",
    ...["shell", "powershell", "write", "edit", "create", "view", "glob", "grep", "task", "web_fetch"].map(t => `--deny-tool=${t}`),
    "--no-custom-instructions",
    "--no-auto-update"
];

export const INIT_TIMEOUT_MS = 30_000;

/**
 * How long a client with no active turns is kept warm. Long enough to cover
 * a user reading a reply and following up, short enough that a Trilium left
 * open overnight isn't holding a subprocess.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** Routes `session/update` notifications to the turn that owns that session. */
type SessionListener = (params: unknown) => void;

export interface ClientLease {
    readonly client: AcpClient;
    /**
     * Identifies the subprocess this lease belongs to. A session id is only
     * meaningful on the generation that created it — after a reap or a crash
     * the agent has no such session loaded, so callers must compare before
     * prompting an existing session.
     */
    readonly generation: number;
}

interface PooledClient {
    client: AcpClient;
    generation: number;
    listeners: Map<string, SessionListener>;
}

let pooled: PooledClient | undefined;
/** In-flight start, so concurrent first turns share one spawn. */
let starting: Promise<PooledClient> | undefined;
let generationCounter = 0;
let activeTurns = 0;
let idleTimer: NodeJS.Timeout | undefined;

/**
 * Borrow the shared client for one turn, starting it if necessary. Every
 * successful call must be paired with {@link releaseClient} — the reference
 * count is what keeps a turn's subprocess from being reaped underneath it.
 */
export async function acquireClient(binaryPath: string, cwd: string, shell: boolean): Promise<ClientLease> {
    // Count the turn before any await: an idle reap must not slip in between
    // the client being handed out and the caller starting to use it.
    activeTurns++;
    cancelIdleTimer();
    try {
        const entry = await startOrReuse(binaryPath, cwd, shell);
        return { client: entry.client, generation: entry.generation };
    } catch (err) {
        releaseClient();
        throw err;
    }
}

/** Return a lease. The client is reaped once every turn has released it. */
export function releaseClient(): void {
    activeTurns = Math.max(0, activeTurns - 1);
    if (activeTurns === 0 && pooled) {
        armIdleTimer();
    }
}

/**
 * Subscribe to a session's `session/update` notifications for the duration of
 * a turn. Updates for sessions nobody is listening to are dropped, which is
 * what keeps a shared connection from leaking one chat's output into another.
 */
export function addSessionListener(sessionId: string, listener: SessionListener): void {
    pooled?.listeners.set(sessionId, listener);
}

export function removeSessionListener(sessionId: string): void {
    pooled?.listeners.delete(sessionId);
}

async function startOrReuse(binaryPath: string, cwd: string, shell: boolean): Promise<PooledClient> {
    if (pooled?.client.alive) {
        return pooled;
    }
    // A dead client that never fired onExit (or fired it after we read it).
    pooled = undefined;

    if (!starting) {
        starting = start(binaryPath, cwd, shell).finally(() => {
            starting = undefined;
        });
    }
    return starting;
}

async function start(binaryPath: string, cwd: string, shell: boolean): Promise<PooledClient> {
    const generation = ++generationCounter;
    const listeners = new Map<string, SessionListener>();

    const client = AcpClient.start(binaryPath, {
        cwd,
        shell,
        args: COPILOT_ACP_ARGS,
        onNotification: (method, params) => {
            if (method !== "session/update") {
                return;
            }
            const sessionId = (params as { sessionId?: string }).sessionId;
            if (sessionId) {
                listeners.get(sessionId)?.(params);
            }
        },
        onAgentRequest: (method, params) => agentRequestHandler(method, params),
        onExit: error => {
            // Only evict ourselves: a later generation may already be running.
            if (pooled?.generation === generation) {
                pooled = undefined;
            }
            listeners.clear();
            getLog().info(`Copilot Agent provider: agent process #${generation} ended (${error.message}); the next turn will start a new one.`);
        }
    });

    try {
        await client.request(
            "initialize",
            {
                protocolVersion: 1,
                clientInfo: { name: "trilium-notes", version: "1.0" },
                // No fs capabilities: the agent must never touch the host
                // filesystem — notes are its only data surface.
                clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
            },
            INIT_TIMEOUT_MS
        );
    } catch (err) {
        client.dispose();
        throw err;
    }

    const entry: PooledClient = { client, generation, listeners };
    pooled = entry;
    return entry;
}

/**
 * The agent→client request handler, installed by the provider. Kept as a
 * hook so the permission policy stays with the provider that defines it,
 * while the pool owns the connection.
 */
let agentRequestHandler: (method: string, params: unknown) => unknown = () => {
    throw new Error("No agent request handler installed.");
};

export function setAgentRequestHandler(handler: (method: string, params: unknown) => unknown): void {
    agentRequestHandler = handler;
}

function armIdleTimer(): void {
    cancelIdleTimer();
    idleTimer = setTimeout(() => {
        idleTimer = undefined;
        if (activeTurns === 0 && pooled) {
            getLog().info(`Copilot Agent provider: reaping the idle agent process after ${Math.round(IDLE_TIMEOUT_MS / 1000)} s.`);
            disposePooled();
        }
    }, IDLE_TIMEOUT_MS);
    // Don't hold the event loop open just to reap an idle subprocess.
    idleTimer.unref?.();
}

function cancelIdleTimer(): void {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
    }
}

function disposePooled(): void {
    const entry = pooled;
    pooled = undefined;
    entry?.listeners.clear();
    entry?.client.dispose();
}

/** For tests: drop the shared client and all bookkeeping. */
export function resetCopilotClientPoolForTests(): void {
    cancelIdleTimer();
    disposePooled();
    starting = undefined;
    activeTurns = 0;
    generationCounter = 0;
}
