/**
 * Minimal Agent Client Protocol (ACP) client: newline-delimited JSON-RPC 2.0
 * over a subprocess's stdio, as spoken by `copilot --acp` (and other ACP
 * agents — see https://agentclientprotocol.com/).
 *
 * Deliberately dependency-free and transport-only: protocol semantics
 * (initialize, session/new, session/prompt, permission policy) live in the
 * provider. The client handles framing, request/response correlation,
 * agent→client requests, and subprocess lifecycle.
 */

import { getLog } from "@triliumnext/core";
import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createInterface } from "readline";

interface JsonRpcMessage {
    jsonrpc: "2.0";
    id?: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export class AcpError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly data?: unknown
    ) {
        super(message);
        this.name = "AcpError";
    }
}

export interface AcpClientOptions {
    cwd: string;
    /** Extra CLI arguments after `--acp`. */
    args?: string[];
    /**
     * Launch through a shell (required for npm `.cmd` shims on Windows). The
     * binary path is quoted by the client when set.
     */
    shell?: boolean;
    /** Called for every notification (no `id`) the agent sends. */
    onNotification?: (method: string, params: unknown) => void;
    /**
     * Called for every agent→client *request* (has an `id`; e.g.
     * `session/request_permission`). The returned value is sent as the
     * response result; a thrown error becomes a JSON-RPC error response.
     * When no handler is set, requests are answered with "method not found".
     */
    onAgentRequest?: (method: string, params: unknown) => Promise<unknown> | unknown;
    /**
     * Called once when the subprocess dies on its own (crash, kill, agent
     * exit) — never for a deliberate {@link AcpClient.dispose}. A pooled
     * client uses this to evict itself so the next turn starts a fresh agent
     * instead of handing out a corpse.
     */
    onExit?: (error: Error) => void;
}

export class AcpClient {
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void; reject: (err: Error) => void }>();
    private exitError: Error | undefined;
    private disposed = false;

    private constructor(
        private readonly proc: ChildProcessWithoutNullStreams,
        private readonly options: AcpClientOptions
    ) {
        const rl = createInterface({ input: proc.stdout });
        rl.on("line", line => this.handleLine(line));

        proc.stderr.on("data", (data: Buffer) => {
            const text = data.toString().trim();
            if (text) {
                getLog().info(`ACP agent stderr: ${text}`);
            }
        });

        // Writing to a subprocess that already exited (a late session/cancel, or
        // an agent-request reply resumed after dispose()) emits EPIPE on stdin.
        // An unhandled stream "error" event would take the server down, and
        // failAll() has already rejected everything in flight — there is nothing
        // left to report.
        proc.stdin.on("error", () => {});

        proc.on("error", err => this.die(new Error(`Failed to start the ACP agent: ${err.message}`)));
        proc.on("exit", (code, sig) => {
            // A deliberate dispose() kills the subprocess — that exit is expected
            // and must not surface as an error for in-flight (cancelled) requests.
            if (!this.disposed) {
                this.die(new Error(`The ACP agent exited unexpectedly (${sig ?? `code ${code}`}).`));
            }
        });
    }

    static start(binary: string, options: AcpClientOptions): AcpClient {
        const proc = spawn(
            options.shell ? `"${binary}"` : binary,
            ["--acp", ...(options.args ?? [])],
            {
                cwd: options.cwd,
                shell: options.shell ?? false,
                stdio: ["pipe", "pipe", "pipe"],
                env: process.env
            }
        );
        return new AcpClient(proc, options);
    }

    /** Send a request and await its response result (rejects with {@link AcpError} on error responses). */
    async request<T = unknown>(method: string, params: unknown, timeoutMs = 120_000): Promise<T> {
        if (this.exitError) {
            throw this.exitError;
        }
        const id = this.nextId++;
        const response = await new Promise<JsonRpcMessage>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`ACP request "${method}" timed out after ${Math.round(timeoutMs / 1000)} s.`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: msg => {
                    clearTimeout(timer);
                    resolve(msg);
                },
                reject: err => {
                    clearTimeout(timer);
                    reject(err);
                }
            });
            try {
                this.send({ jsonrpc: "2.0", id, method, params });
            } catch (err) {
                // A synchronous write failure would otherwise leave the timer
                // armed and the id stranded in `pending` until it elapses.
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
        if (response.error) {
            throw new AcpError(response.error.code, response.error.message, response.error.data);
        }
        return response.result as T;
    }

    /** Send a notification (fire-and-forget, e.g. `session/cancel`). */
    notify(method: string, params: unknown): void {
        this.send({ jsonrpc: "2.0", method, params });
    }

    /** Kill the subprocess and reject anything still in flight. */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.failAll(new Error("The ACP client was disposed."));
        this.proc.kill();
    }

    private send(message: JsonRpcMessage): void {
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private handleLine(line: string): void {
        if (!line.trim()) {
            return;
        }
        let message: JsonRpcMessage;
        try {
            const parsed: unknown = JSON.parse(line);
            if (!parsed || typeof parsed !== "object") {
                // Valid JSON, but not a protocol message (a bare `null` would
                // otherwise blow up on the property reads below).
                return;
            }
            message = parsed as JsonRpcMessage;
        } catch {
            // Not part of the protocol stream (e.g. a stray banner) — ignore.
            return;
        }

        if (message.id !== undefined && message.method === undefined) {
            // Response to one of our requests.
            const entry = this.pending.get(message.id as number);
            if (entry) {
                this.pending.delete(message.id as number);
                entry.resolve(message);
            }
        } else if (message.method !== undefined && message.id !== undefined) {
            void this.answerAgentRequest(message.id, message.method, message.params);
        } else if (message.method !== undefined) {
            this.options.onNotification?.(message.method, message.params);
        }
    }

    private async answerAgentRequest(id: number | string, method: string, params: unknown): Promise<void> {
        const handler = this.options.onAgentRequest;
        if (!handler) {
            this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Client does not support "${method}".` } });
            return;
        }
        try {
            const result = await handler(method, params);
            this.send({ jsonrpc: "2.0", id, result });
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            this.send({ jsonrpc: "2.0", id, error: { code: -32603, message: text } });
        }
    }

    /** Whether the subprocess is still usable (not disposed, not exited). */
    get alive(): boolean {
        return !this.disposed && this.exitError === undefined;
    }

    /**
     * The subprocess died on its own. Fails everything in flight, then tells
     * the owner exactly once so a pooled client can evict itself.
     */
    private die(error: Error): void {
        const alreadyDead = this.exitError !== undefined;
        this.failAll(error);
        if (!alreadyDead) {
            this.options.onExit?.(error);
        }
    }

    private failAll(error: Error): void {
        this.exitError = error;
        for (const entry of this.pending.values()) {
            entry.reject(error);
        }
        this.pending.clear();
    }
}
