import { ConflictError, GoneError, type HttpError, NotFoundError, utils as coreUtils, ValidationError } from "@triliumnext/core";
import { Mutex } from "async-mutex";
import type { Request } from "express";
import { createWriteStream } from "fs";
import fsp from "fs/promises";
import path from "path";
import { Transform, type TransformCallback } from "stream";
import { pipeline } from "stream/promises";

/**
 * Receives a large file as a sequence of appended chunks, so that an upload measured in gigabytes
 * survives what a single request would not: a proxy's body limit, a request timeout, a dropped
 * connection, and a progress bar that has nothing to report until the very end.
 *
 * The protocol is one rule: a chunk states the offset it belongs at, and that offset must equal how
 * much the server has already received. Sparse writes, duplicated chunks and two clients writing to
 * one session all fail that check, and a client that lost a response only has to ask where the file
 * got to and carry on from there.
 *
 * Sessions live in memory while their files do not, so an upload cannot outlive the process that is
 * receiving it. What it can do is say so: every upload id is stamped with the process that issued
 * it, and one presented to a later process is answered as gone rather than as expired, which is the
 * difference between a client waiting out a retry and one starting again.
 *
 * Nothing here knows what the file is for. A consumer supplies {@link ChunkedUploadConfig.onComplete},
 * which is handed the assembled file and takes ownership of it.
 *
 * @example Mounting an upload endpoint
 * ```ts
 * const upload = createChunkedUpload({
 *     name: "restore",
 *     directory: path.join(dataDirs.TMP_DIR, "uploads"),
 *     maxTotalBytes: 64 * 1024 * 1024 * 1024,
 *     onComplete: async ({ path: uploadedPath }) => restoreService.stage(uploadedPath)
 * });
 *
 * asyncRoute(PST, "/api/setup/restore/upload/begin", [guard], upload.begin, apiResultHandler);
 * ```
 *
 * @module
 */

/** Chunk size advertised to clients, chosen to stay under the body limit of a typical reverse proxy. */
export const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** How many endings are kept, which only has to cover the clients still talking about them. */
const REMEMBERED_ENDINGS = 16;

/** The assembled file, handed to the consumer once every byte is in. */
export interface CompletedUpload {
    /**
     * Where the file is. The consumer **takes ownership**: it may rename the file into place, read
     * it, or delete it, and the upload no longer tracks it. Renaming within the same filesystem is
     * what keeps a multi-gigabyte upload from being copied a second time.
     */
    path: string;
    /** The name the client gave the file, reduced to a base name. */
    fileName: string;
    totalBytes: number;
    /** Whatever the client sent to `begin`, passed through untouched. */
    metadata: Record<string, unknown>;
}

export interface ChunkedUploadConfig<T> {
    /** Identifies this upload's files and log lines; also its subdirectory. */
    name: string;
    /** Where partial uploads are kept. Created if missing. */
    directory: string;
    /** Refuses anything larger, before a byte is written. */
    maxTotalBytes: number;
    /** Advertised to the client by `begin`; defaults to {@link DEFAULT_CHUNK_SIZE}. */
    chunkSize?: number;
    /** How long a session survives without activity. Defaults to an hour. */
    sessionTtlMs?: number;
    /** Sessions that may be open at once. Defaults to one. */
    maxConcurrentSessions?: number;
    /**
     * What one more session than {@link maxConcurrentSessions} allows does: `refuse` turns the new
     * one away, `supersede` ends the oldest to make room for it. Defaults to refusing.
     *
     * Superseding is for an upload that is the only way into what it feeds. A client whose
     * connection is gone cannot tell the server to forget its session, so that session stands in the
     * way for the whole of {@link sessionTtlMs} — and the user, who knows only that their upload
     * failed, is refused every attempt to start it again for the next hour.
     */
    whenAtCapacity?: "refuse" | "supersede";
    /**
     * Checks the filesystem has room for the whole file before accepting it, so an upload that
     * cannot possibly fit fails at the start rather than after hours.
     */
    requireFreeSpace?: boolean;
    /** Called once the file is complete. See {@link CompletedUpload} on ownership. */
    onComplete(upload: CompletedUpload): Promise<T>;
    /**
     * Called when a session ends without producing anything: expired, aborted, refused for
     * contradicting its declared size, or completed but rejected by {@link onComplete}.
     *
     * For a consumer that set something aside for the upload's sake, which nothing would otherwise
     * put back: an expiry happens on a timer, with no request to fail and nobody to tell.
     */
    onSessionDiscarded?(): void;
}

/** What a client is told about a session, whether it is starting one or resuming one. */
export interface ChunkedUploadStatus {
    uploadId: string;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    /** Size of the chunks the client should send. */
    chunkSize: number;
    /** When the session is dropped if nothing more arrives, as a Unix timestamp in milliseconds. */
    expiresAt: number;
}

export interface ChunkedUpload<T> {
    /**
     * How many uploads are open, not counting any whose time has run out since the last sweep.
     *
     * For a consumer that sets something aside for an upload's sake and has to know, before putting
     * it back, whether any upload still depends on it.
     */
    activeSessions(): number;
    begin(req: Request): Promise<ChunkedUploadStatus>;
    chunk(req: Request): Promise<ChunkedUploadStatus>;
    status(req: Request): Promise<ChunkedUploadStatus>;
    finish(req: Request): Promise<T>;
    abort(req: Request): Promise<void>;
    /** Drops expired sessions and any partial file left behind by an earlier run. */
    sweep(): Promise<void>;
    /** Stops the sweep timer. For tests, and for a shutdown that wants to be tidy. */
    stop(): void;
}

/**
 * Builds a set of request handlers implementing the chunked upload protocol.
 *
 * The handlers are plain route handlers returning their result, so they slot into `asyncRoute` with
 * `apiResultHandler` like any other endpoint. Failures are thrown as {@link HttpError} subclasses,
 * which the route layer turns into the matching status code.
 */
export function createChunkedUpload<T>(config: ChunkedUploadConfig<T>): ChunkedUpload<T> {
    const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    const maxConcurrentSessions = config.maxConcurrentSessions ?? 1;
    const directory = path.resolve(config.directory, config.name);
    const sessions = new Map<string, Session>();
    /** What became of the sessions that ended recently, for a client that comes back to one. */
    const endings = new Map<string, Ending<T>>();
    /** Lets one caller at a time open a session, so the limit on how many are open holds. */
    const admission = new Mutex();
    /**
     * Stamped onto every upload id this process issues, so one issued by the process before it is
     * recognised as such. A restart ends every session while leaving the client mid-upload none the
     * wiser, and "the server restarted" is something it can act on where "no such upload" is not.
     *
     * Minted when it is first wanted rather than here: an upload service is built as its module
     * loads, which is before there is any crypto to draw a random string from.
     */
    let instanceId: string | null = null;

    // Unreferenced so neither a test nor a shutdown waits on it.
    const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
    timer.unref?.();

    /**
     * Opens a session, one caller at a time.
     *
     * Looking at the count and taking a place are several awaits apart: sweeping first, then reading
     * the free space, then creating the file. Two requests arriving together would both look while
     * the other was between those steps, both see room, and both take it — which on an endpoint that
     * needs no authentication is as many uploads, and as much of the disk, as anyone cares to ask
     * for. Serialising the whole of it makes the two one act.
     */
    async function begin(req: Request): Promise<ChunkedUploadStatus> {
        return admission.runExclusive(() => admit(req));
    }

    async function admit(req: Request): Promise<ChunkedUploadStatus> {
        const { fileName, totalBytes, metadata } = (req.body ?? {}) as BeginBody;

        // Before the count is checked, so an abandoned session never blocks the next one.
        await sweep();

        // Everything the request can be turned away for comes first: where a new session takes the
        // place of an old one, a malformed request must not cost a healthy upload its session on its
        // way to being refused.
        if (typeof totalBytes !== "number" || !Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
            throw new ValidationError("The size of the upload must be stated as a positive integer.");
        }
        if (totalBytes > config.maxTotalBytes) {
            throw new ValidationError(
                `The upload is ${totalBytes} bytes, above the limit of ${config.maxTotalBytes}.`
            );
        }

        while (sessions.size >= maxConcurrentSessions) {
            if (config.whenAtCapacity !== "supersede") {
                throw new ConflictError("Another upload is already in progress.");
            }

            // Oldest first, the map keeping them in the order they were opened. Remembered as
            // superseded, so the client it belonged to is told what became of it rather than left to
            // conclude that its own upload timed out.
            const [ oldest ] = sessions.values();
            remember(oldest.uploadId, { kind: "superseded" });
            await drop(oldest);
        }

        // After the room an ended session gave back, which is the difference between fitting and not
        // when the upload being replaced is another copy of the same database.
        if (config.requireFreeSpace) {
            await requireRoomFor(directory, totalBytes);
        }

        await fsp.mkdir(directory, { recursive: true });

        const uploadId = `${stamp()}-${coreUtils.randomString(20)}`;
        const session: Session = {
            uploadId,
            // A base name, so a crafted name cannot reach outside the upload directory. Only ever
            // handed back to the consumer; the file on disk is named after the session.
            fileName: path.basename(String(fileName ?? "upload")),
            totalBytes,
            receivedBytes: 0,
            metadata: (metadata ?? {}) as Record<string, unknown>,
            path: path.join(directory, `${uploadId}.part`),
            expiresAt: Date.now() + sessionTtlMs,
            writing: new Mutex()
        };

        // Truncates any file left at this path, so a session always starts from nothing.
        await fsp.writeFile(session.path, "");
        sessions.set(uploadId, session);

        return describe(session);
    }

    /**
     * Appends one chunk. The request body is streamed straight to the file: buffering it would put a
     * chunk of every concurrent upload in memory, which is the thing this protocol exists to avoid.
     */
    async function chunk(req: Request): Promise<ChunkedUploadStatus> {
        const session = sessionFor(req);
        const offset = Number(req.query.offset);

        return session.writing.runExclusive(async () => {
            if (!Number.isSafeInteger(offset) || offset < 0) {
                throw new ValidationError("The offset of a chunk must be stated as an integer.");
            }
            if (offset !== session.receivedBytes) {
                throw new ConflictError(
                    `Chunk starts at ${offset}, but ${session.receivedBytes} bytes have been received.`
                );
            }

            const destination = createWriteStream(session.path, { flags: "a" });
            let failure: unknown;
            try {
                // Capped as it is written, not measured once it is written: nothing authenticates the
                // caller here, so one that declares a megabyte and then sends a hundred gigabytes has
                // to be cut off mid-flight rather than found out when the disk is already full.
                await pipeline(req, cappedAt(session.totalBytes - session.receivedBytes), destination);
            } catch (e) {
                failure = e;
            }

            // Whether the chunk arrived whole or the connection dropped partway, what counts is what
            // reached the disk. Reading it back is what lets a broken chunk be resumed from the exact
            // byte it stopped at rather than being re-sent or, worse, double-written.
            session.receivedBytes = await sizeOf(session.path);
            session.expiresAt = Date.now() + sessionTtlMs;

            if (failure) {
                // An overshoot is the caller contradicting what it declared, so the upload goes with
                // it; a broken connection is kept, since that is exactly what resuming is for.
                if (failure instanceof ValidationError) {
                    await drop(session);
                }

                throw failure;
            }

            return describe(session);
        });
    }

    async function status(req: Request): Promise<ChunkedUploadStatus> {
        return describe(sessionFor(req));
    }

    async function finish(req: Request): Promise<T> {
        // A `finish` whose answer never arrived is asked again, and by then the session is gone and
        // the file with it. Without the answer being kept, the only way back for that client would
        // be to send the whole upload a second time.
        const completed = endings.get(String(req.params.uploadId));
        if (completed?.kind === "completed") {
            return completed.result;
        }

        const session = sessionFor(req);

        return session.writing.runExclusive(async () => {
            if (session.receivedBytes !== session.totalBytes) {
                throw new ConflictError(
                    `The upload has ${session.receivedBytes} of ${session.totalBytes} bytes.`
                );
            }

            // Ownership passes with the call, so the session goes first: the consumer is free to
            // rename the file, and a sweep must not delete what is no longer ours.
            sessions.delete(session.uploadId);

            try {
                const result = await config.onComplete({
                    path: session.path,
                    fileName: session.fileName,
                    totalBytes: session.totalBytes,
                    metadata: session.metadata
                });
                remember(session.uploadId, { kind: "completed", result });

                return result;
            } catch (e) {
                // The consumer may have taken the file or may have failed before touching it; either
                // way nothing else will come back for it.
                await fsp.rm(session.path, { force: true }).catch(() => {});
                config.onSessionDiscarded?.();

                throw e;
            }
        });
    }

    async function abort(req: Request): Promise<void> {
        await drop(sessionFor(req));
    }

    /**
     * Drops what has expired, then anything in the directory no live session claims — which after a
     * restart is everything, since sessions live only in memory while their files do not.
     */
    async function sweep(): Promise<void> {
        const now = Date.now();
        for (const session of [...sessions.values()]) {
            if (session.expiresAt <= now) {
                await drop(session);
            }
        }

        let fileNames: string[];
        try {
            fileNames = await fsp.readdir(directory);
        } catch {
            return;
        }

        const live = new Set([...sessions.values()].map((session) => session.path));
        for (const fileName of fileNames) {
            const filePath = path.join(directory, fileName);
            if (!live.has(filePath)) {
                await fsp.rm(filePath, { force: true }).catch(() => {});
            }
        }
    }

    function sessionFor(req: Request): Session {
        const uploadId = String(req.params.uploadId);
        const session = sessions.get(uploadId);
        if (!session) {
            throw endingOf(uploadId);
        }
        return session;
    }

    /**
     * Why an upload is no longer here, in the terms a client can act on.
     *
     * The two that are worth telling apart from an expiry are the ones the client did not cause and
     * cannot wait out: an upload that another took the place of, and one issued by the process that
     * was running before this one. Both are final, where an expiry at least reads as something that
     * took too long.
     */
    function endingOf(uploadId: string): HttpError {
        if (endings.get(uploadId)?.kind === "superseded") {
            return new GoneError("Another upload took over. Only one upload runs at a time.");
        }
        if (!uploadId.startsWith(`${stamp()}-`)) {
            return new GoneError("The server restarted, so the upload it was holding is gone.");
        }

        return new NotFoundError("No such upload. It may have expired.");
    }

    /** This process's mark, made the first time anything needs it. */
    function stamp(): string {
        return instanceId ??= coreUtils.randomString(8);
    }

    /** Keeps the last few endings, so the map cannot grow with every upload the process ever saw. */
    function remember(uploadId: string, ending: Ending<T>): void {
        endings.set(uploadId, ending);

        while (endings.size > REMEMBERED_ENDINGS) {
            const [ oldest ] = endings.keys();
            endings.delete(oldest);
        }
    }

    /**
     * Ends a session that produced nothing: expired, aborted, or contradicted what it declared.
     *
     * The consumer is told, because an upload is rarely the only thing that was set aside for it, and
     * these are the endings nobody is waiting on a response for — an expiry has no caller at all.
     */
    async function drop(session: Session): Promise<void> {
        sessions.delete(session.uploadId);
        await fsp.rm(session.path, { force: true }).catch(() => {});

        config.onSessionDiscarded?.();
    }

    function describe(session: Session): ChunkedUploadStatus {
        return {
            uploadId: session.uploadId,
            fileName: session.fileName,
            totalBytes: session.totalBytes,
            receivedBytes: session.receivedBytes,
            chunkSize,
            expiresAt: session.expiresAt
        };
    }

    /**
     * Counted rather than taken from the map's size: a session whose time has run out is gone as far
     * as anyone asking is concerned, whether or not a sweep has got to it yet.
     */
    function activeSessions(): number {
        const now = Date.now();

        return [ ...sessions.values() ].filter((session) => session.expiresAt > now).length;
    }

    return {
        activeSessions,
        begin,
        chunk,
        status,
        finish,
        abort,
        sweep,
        stop: () => clearInterval(timer)
    };
}

interface Session {
    uploadId: string;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    metadata: Record<string, unknown>;
    path: string;
    expiresAt: number;
    /** Serialises writes, so the offset a chunk is checked against is the one it is written at. */
    writing: Mutex;
}

/**
 * What became of a session that is no longer open, for as long as a client may still ask after it.
 *
 * Only the endings a client has something to do about are kept. An expiry is not one of them: it is
 * what an unknown upload id means already.
 */
type Ending<T> =
    | { kind: "superseded" }
    | { kind: "completed"; result: T };

interface BeginBody {
    fileName?: string;
    totalBytes?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Passes at most `allowance` bytes through and fails on the one that would exceed it.
 *
 * A body arrives with nothing bounding it but what the sender chooses to send: `Content-Length` is
 * the sender's own claim, and the chunk content type is deliberately one no body parser handles. So
 * the ceiling is applied to the bytes themselves, on their way past, and the write ends the moment
 * one too many arrives.
 */
function cappedAt(allowance: number): Transform {
    let seen = 0;

    return new Transform({
        transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
            seen += chunk.length;
            if (seen > allowance) {
                callback(new ValidationError("The upload sent more bytes than it declared."));
                return;
            }

            callback(null, chunk);
        }
    });
}

/** How much of the file is there, counting a file that is not there at all as nothing. */
async function sizeOf(filePath: string): Promise<number> {
    try {
        return (await fsp.stat(filePath)).size;
    } catch {
        return 0;
    }
}

/**
 * Refuses an upload the filesystem cannot hold, which is worth knowing at the start of an hour-long
 * transfer rather than at the end of one. A filesystem that cannot be measured is taken as roomy:
 * the check is there to give a clear answer, not to become a new way to fail.
 */
async function requireRoomFor(directory: string, totalBytes: number): Promise<void> {
    let available: number;
    try {
        const parent = path.dirname(directory);
        const stats = await fsp.statfs(parent);
        available = stats.bavail * stats.bsize;
    } catch {
        return;
    }

    if (available < totalBytes) {
        throw new ValidationError(
            `The upload needs ${totalBytes} bytes and only ${available} are free.`
        );
    }
}
