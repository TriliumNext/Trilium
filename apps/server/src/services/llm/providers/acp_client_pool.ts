/**
 * Keeps one ACP agent subprocess per provider alive across chat turns.
 *
 * Starting an agent and opening a session is expensive: a cold Copilot turn
 * pays ~785 ms to spawn and run `initialize` plus ~2.4 s for the first
 * `session/new`, and Antigravity's server takes ~15 s to start on Windows. None
 * of that is model latency, and all of it repeats on every message when the
 * client is disposed at the end of each turn.
 *
 * ACP is built for sharing: one connection hosts many sessions, each addressed
 * by `sessionId`. So the pool hands every turn the same client, routes each
 * `session/update` and permission request to the turn that owns its session,
 * and reaps the subprocess after {@link IDLE_TIMEOUT_MS} without a turn. A
 * client that dies on its own evicts itself, so the next turn starts a new one.
 */

import { getLog } from "@triliumnext/core";
import type { LlmProviderConfig } from "@triliumnext/core/src/services/llm/types.js";

import type { AcpClient } from "./acp_client.js";

/**
 * How long a client with no active turns is kept warm: long enough to cover a
 * user reading a reply and following up, short enough that a Trilium left open
 * overnight does not hold a subprocess.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** What a turn registers for its session on the shared connection. */
export interface AcpSessionTurn {
    /** Receives the session's `session/update` notifications. */
    onUpdate: (params: unknown) => void;
    /** The chat turn's configuration, which the permission policy reads. */
    config?: LlmProviderConfig;
}

/** The callbacks a pooled client is started with. */
export interface AcpPoolConnection {
    onNotification: (method: string, params: unknown) => void;
    /** The configuration of the turn that owns `sessionId`, if one is attached. */
    turnConfig: (sessionId: string | undefined) => LlmProviderConfig | undefined;
    onExit: (error: Error) => void;
}

export interface AcpLease {
    readonly client: AcpClient;
    /**
     * Identifies the subprocess the lease belongs to. A session exists only in
     * the process that created or loaded it, so a caller compares generations
     * before prompting a session it mapped earlier.
     */
    readonly generation: number;
}

interface PooledClient {
    client: AcpClient;
    generation: number;
    turns: Map<string, AcpSessionTurn>;
}

export class AcpClientPool {
    private pooled?: PooledClient;
    /** The in-flight start, so concurrent first turns share one spawn. */
    private starting?: Promise<PooledClient>;
    private generationCounter = 0;
    private activeTurns = 0;
    private idleTimer?: NodeJS.Timeout;

    constructor(private readonly logLabel: string) {}

    /**
     * Borrow the shared client for one turn, starting it with `connect` if no
     * live one exists. Every successful call must be paired with
     * {@link release}: the count keeps a turn's subprocess from being reaped.
     */
    async acquire(connect: (connection: AcpPoolConnection) => Promise<AcpClient>): Promise<AcpLease> {
        // Count the turn before any await, so an idle reap cannot run between
        // the client being handed out and the caller using it.
        this.activeTurns++;
        this.cancelIdleTimer();
        try {
            const entry = await this.startOrReuse(connect);
            return { client: entry.client, generation: entry.generation };
        } catch (err) {
            this.release();
            throw err;
        }
    }

    /** Whether a live process is ready, so {@link acquire} hands it out without starting one. */
    get warm(): boolean {
        return this.pooled?.client.alive === true;
    }

    /** Return a lease. The client is reaped once no turn has used it for {@link IDLE_TIMEOUT_MS}. */
    release(): void {
        this.activeTurns = Math.max(0, this.activeTurns - 1);
        if (this.activeTurns === 0 && this.pooled) {
            this.armIdleTimer();
        }
    }

    /**
     * Route a session's updates and permission requests to a turn. Updates for
     * a session without a turn are dropped, which keeps one chat's output out of
     * another and a `session/load` replay out of the chat.
     */
    attach(sessionId: string, turn: AcpSessionTurn): void {
        this.pooled?.turns.set(sessionId, turn);
    }

    detach(sessionId: string): void {
        this.pooled?.turns.delete(sessionId);
    }

    /** Stop the pooled subprocess now. */
    dispose(): void {
        this.cancelIdleTimer();
        const entry = this.pooled;
        this.pooled = undefined;
        this.starting = undefined;
        this.activeTurns = 0;
        entry?.turns.clear();
        entry?.client.dispose();
    }

    private async startOrReuse(connect: (connection: AcpPoolConnection) => Promise<AcpClient>): Promise<PooledClient> {
        if (this.pooled?.client.alive) {
            return this.pooled;
        }
        this.pooled = undefined;
        if (!this.starting) {
            this.starting = this.start(connect).finally(() => {
                this.starting = undefined;
            });
        }
        return this.starting;
    }

    private async start(connect: (connection: AcpPoolConnection) => Promise<AcpClient>): Promise<PooledClient> {
        const generation = ++this.generationCounter;
        const turns = new Map<string, AcpSessionTurn>();
        const client = await connect({
            onNotification: (method, params) => {
                const sessionId = (params as { sessionId?: string } | undefined)?.sessionId;
                if (method === "session/update" && sessionId) {
                    turns.get(sessionId)?.onUpdate(params);
                }
            },
            turnConfig: sessionId => (sessionId ? turns.get(sessionId)?.config : undefined),
            onExit: error => {
                // Evict only this generation: a later one can already be running.
                if (this.pooled?.generation === generation) {
                    this.pooled = undefined;
                }
                turns.clear();
                getLog().info(`${this.logLabel}: agent process #${generation} ended (${error.message}); the next turn starts a new one.`);
            }
        });
        const entry: PooledClient = { client, generation, turns };
        this.pooled = entry;
        return entry;
    }

    private armIdleTimer(): void {
        this.cancelIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            if (this.activeTurns === 0 && this.pooled) {
                getLog().info(`${this.logLabel}: reaping the idle agent process after ${Math.round(IDLE_TIMEOUT_MS / 1000)} s.`);
                this.dispose();
            }
        }, IDLE_TIMEOUT_MS);
        // An idle reap does not keep the server running.
        this.idleTimer.unref?.();
    }

    private cancelIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }
}
