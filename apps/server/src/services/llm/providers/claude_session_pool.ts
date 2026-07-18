/**
 * Keeps one Claude Code subprocess alive per chat, across turns.
 *
 * The SDK's default `query({ prompt: "text" })` binds the subprocess to the
 * returned iterator: it spawns on call and dies when iteration ends, so every
 * turn re-pays the spawn. Measured on Windows that is ~2.0 s to the first
 * token cold versus ~0.8 s once the process is warm.
 *
 * The alternative the SDK offers is *streaming input mode*: pass an
 * `AsyncIterable<SDKUserMessage>` as the prompt and the process stays alive
 * consuming messages as they are pushed. That is also the only mode in which
 * the `Query` control methods (`setModel`, `interrupt`) work — which is what
 * lets a mid-chat model switch happen without a respawn (measured: ~0 ms).
 *
 * Turns within a chat are strictly sequential (one user waiting on one reply),
 * so a turn can simply drive `query.next()` until its `result` message and
 * stop — no persistent consumer or turn queue is needed. Iteration must be
 * manual: `for await (…) { break }` calls `iterator.return()`, which would
 * close the query and defeat the whole point.
 *
 * Sessions are keyed by chat note, reaped after {@link IDLE_TIMEOUT_MS}, and
 * rebuilt whenever an option that is fixed at construction changes.
 */

import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { getLog } from "@triliumnext/core";

/**
 * How long an unused session's subprocess is kept warm. Unlike the Copilot
 * pool this is one process *per chat*, so the reaper bounds real memory, not
 * just tidiness.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** Sessions kept warm; bounded so many open chats can't exhaust the host. */
export const MAX_WARM_SESSIONS = 8;

/**
 * Bridges push-based turns to the pull-based `AsyncIterable` the SDK wants.
 * Pushing after {@link end} is a no-op rather than a hang: a message enqueued
 * onto a dead stream would otherwise wait on a promise nobody settles.
 */
export class Pushable<T> implements AsyncIterable<T> {
    private readonly queue: T[] = [];
    private readonly resolvers: ((result: IteratorResult<T>) => void)[] = [];
    private done = false;

    push(item: T): void {
        if (this.done) {
            return;
        }
        const resolve = this.resolvers.shift();
        if (resolve) {
            resolve({ value: item, done: false });
        } else {
            this.queue.push(item);
        }
    }

    /** Messages pushed but not yet consumed — for assertions in tests. */
    get pending(): readonly T[] {
        return this.queue;
    }

    end(): void {
        this.done = true;
        let resolve = this.resolvers.shift();
        while (resolve) {
            resolve({ value: undefined as never, done: true });
            resolve = this.resolvers.shift();
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (this.queue.length > 0) {
                    return Promise.resolve({ value: this.queue.shift() as T, done: false });
                }
                if (this.done) {
                    return Promise.resolve({ value: undefined as never, done: true });
                }
                return new Promise<IteratorResult<T>>(resolve => this.resolvers.push(resolve));
            }
        };
    }
}

export interface ClaudeSession {
    readonly query: Query;
    readonly input: Pushable<SDKUserMessage>;
    /**
     * Options that cannot be changed after `query()` starts (system prompt,
     * note tools, thinking, resume target). A mismatch forces a new session.
     */
    readonly fingerprint: string;
    /** The agent session id, learned from the first message that carries one. */
    sessionId?: string;
    /** Set once the stream ends; pushing onto a closed session would hang. */
    closed: boolean;
    /** A turn is currently driving `query.next()`. */
    busy: boolean;
    /** Last model asked for via `setModel`, so it is only re-sent on change. */
    model?: string;
    idleTimer?: NodeJS.Timeout;
}

const sessionsByChatNote = new Map<string, ClaudeSession>();

/**
 * The warm session for a chat, or undefined when the caller must build one.
 * A session that is closed, busy, or built with different construction-time
 * options is dropped here so the caller starts fresh.
 */
export function takeWarmSession(chatNoteId: string, fingerprint: string): ClaudeSession | undefined {
    const session = sessionsByChatNote.get(chatNoteId);
    if (!session) {
        return undefined;
    }
    if (session.closed || session.busy || session.fingerprint !== fingerprint) {
        // Busy means a previous turn is still streaming — rather than queue
        // behind it, the caller gets a fresh session and this one is retired.
        closeSession(chatNoteId, session);
        return undefined;
    }
    cancelIdleTimer(session);
    session.busy = true;
    return session;
}

/** Register a freshly built session as this chat's warm one. */
export function rememberSession(chatNoteId: string, session: ClaudeSession): void {
    const previous = sessionsByChatNote.get(chatNoteId);
    if (previous && previous !== session) {
        closeSession(chatNoteId, previous);
    }
    session.busy = true;
    sessionsByChatNote.delete(chatNoteId);
    sessionsByChatNote.set(chatNoteId, session);
    evictOldest();
}

/** Hand a session back after a turn; it is reaped once idle for long enough. */
export function releaseSession(chatNoteId: string, session: ClaudeSession): void {
    session.busy = false;
    if (session.closed) {
        sessionsByChatNote.delete(chatNoteId);
        return;
    }
    cancelIdleTimer(session);
    session.idleTimer = setTimeout(() => {
        session.idleTimer = undefined;
        if (!session.busy) {
            getLog().info(`Claude Agent provider: reaping the idle agent process for chat ${chatNoteId}.`);
            closeSession(chatNoteId, session);
        }
    }, IDLE_TIMEOUT_MS);
    // Don't hold the event loop open just to reap an idle subprocess.
    session.idleTimer.unref?.();
}

/** End the stream and terminate the subprocess. Safe to call more than once. */
export function closeSession(chatNoteId: string, session: ClaudeSession): void {
    cancelIdleTimer(session);
    if (sessionsByChatNote.get(chatNoteId) === session) {
        sessionsByChatNote.delete(chatNoteId);
    }
    if (session.closed) {
        return;
    }
    session.closed = true;
    try {
        session.input.end();
        session.query.close();
    } catch (err) {
        getLog().info(`Claude Agent provider: error closing the agent session (${err instanceof Error ? err.message : String(err)}).`);
    }
}

function evictOldest(): void {
    while (sessionsByChatNote.size > MAX_WARM_SESSIONS) {
        const [oldestId, oldest] = [...sessionsByChatNote.entries()][0];
        // Never evict a session mid-turn; stop at the first busy one so a
        // pathological all-busy map degrades to "no eviction" instead of
        // killing a live reply.
        if (oldest.busy) {
            break;
        }
        closeSession(oldestId, oldest);
    }
}

function cancelIdleTimer(session: ClaudeSession): void {
    if (session.idleTimer) {
        clearTimeout(session.idleTimer);
        session.idleTimer = undefined;
    }
}

/** For tests: close every warm session and forget the map. */
export function resetClaudeSessionPoolForTests(): void {
    for (const [chatNoteId, session] of [...sessionsByChatNote.entries()]) {
        closeSession(chatNoteId, session);
    }
    sessionsByChatNote.clear();
}
