import { createHash, type Hash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

import { BackupContainerError } from "./errors.js";
import {
    FRAME_FINAL_FLAG,
    FRAME_SIZE,
    GZIP_OS_UNKNOWN,
    MAX_FRAME_COUNTER,
    SQLITE_HEADER_BYTES,
    validateSqliteHeader
} from "./format.js";
import { sealFrame } from "./crypto.js";

/** Passes bytes through untouched while hashing them, so the digest costs no extra pass. */
export class DigestTap extends Transform {

    readonly #hash: Hash = createHash("sha256");
    #bytes = 0;

    /** Payload bytes seen, i.e. the bytes the digest covers. */
    get bytesHashed(): number {
        return this.#bytes;
    }

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {
        this.#hash.update(chunk);
        this.#bytes += chunk.length;
        callback(null, chunk);
    }

    digest(): Buffer {
        return this.#hash.digest();
    }

}

/**
 * Forces the gzip OS byte to "unknown".
 *
 * Node emits MTIME 0 and no FNAME or FEXTRA already, but the OS byte follows the build platform (3
 * on Unix, 10 on Windows), which would leak where the backup was written. The byte is informational
 * and outside gzip's CRC, so rewriting it is safe.
 */
export class GzipHeaderNormaliser extends Transform {

    #seen = 0;

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {
        const osByteIndex = 9 - this.#seen;
        if (osByteIndex >= 0 && osByteIndex < chunk.length) {
            // Copy first: the buffer belongs to zlib.
            chunk = Buffer.from(chunk);
            chunk[osByteIndex] = GZIP_OS_UNKNOWN;
        }
        this.#seen += chunk.length;
        callback(null, chunk);
    }

}

/**
 * Splits the stream into authenticated frames.
 *
 * Full frames are emitted as soon as they fill and the flush always emits exactly one final frame,
 * which is why a payload that is an exact multiple of the frame size ends with an empty one. That
 * is the canonical framing, and it lets the writer stream without ever needing to know what
 * follows.
 */
export class FrameEncryptor extends Transform {

    readonly #frame = Buffer.allocUnsafe(FRAME_SIZE);
    #filled = 0;
    #counter = 0;

    constructor(
        private readonly key: Buffer,
        private readonly noncePrefix: Buffer,
        private readonly aad: Buffer,
        /** Highest counter a frame may use. Lowered only by tests, which cannot write 4 PiB. */
        private readonly maxCounter: number = MAX_FRAME_COUNTER
    ) {
        super();
    }

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {
        let offset = 0;

        try {
            while (offset < chunk.length) {
                const take = Math.min(FRAME_SIZE - this.#filled, chunk.length - offset);
                chunk.copy(this.#frame, this.#filled, offset, offset + take);
                this.#filled += take;
                offset += take;

                if (this.#filled === FRAME_SIZE) {
                    this.push(this.#seal(false));
                }
            }
        } catch (error) {
            callback(error as Error);
            return;
        }

        callback();
    }

    override _flush(callback: TransformCallback): void {
        try {
            callback(null, this.#seal(true));
        } catch (error) {
            callback(error as Error);
        }
    }

    #seal(final: boolean): Buffer {
        if (this.#counter > this.maxCounter) {
            throw new BackupContainerError(
                "payload-too-large",
                `Payload needs more than ${this.maxCounter + 1} frames.`
            );
        }

        const lengthField = Buffer.allocUnsafe(4);
        lengthField.writeUInt32LE(final ? (this.#filled | FRAME_FINAL_FLAG) >>> 0 : this.#filled);

        const frame = sealFrame(
            this.key,
            this.noncePrefix,
            this.aad,
            this.#counter,
            lengthField,
            this.#frame.subarray(0, this.#filled)
        );

        this.#counter++;
        this.#filled = 0;

        return frame;
    }

}

/**
 * Guards the unwrapped output: enforces the ceiling before bytes reach the destination, checks the
 * SQLite header as soon as enough of it has passed, and counts what was written.
 */
export class OutputGuard extends Transform {

    #written = 0;
    #head: Buffer[] = [];
    #headBytes = 0;
    #headChecked = false;

    constructor(
        private readonly ceiling: number,
        private readonly requireSqliteHeader: boolean
    ) {
        super();
    }

    get bytesWritten(): number {
        return this.#written;
    }

    override _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {
        if (this.#written + chunk.length > this.ceiling) {
            callback(new BackupContainerError(
                "output-too-large",
                `Output would exceed the ${this.ceiling} byte ceiling.`
            ));
            return;
        }
        this.#written += chunk.length;

        if (this.requireSqliteHeader && !this.#headChecked) {
            this.#head.push(chunk);
            this.#headBytes += chunk.length;

            if (this.#headBytes >= SQLITE_HEADER_BYTES) {
                this.#headChecked = true;
                try {
                    validateSqliteHeader(Buffer.concat(this.#head, this.#headBytes));
                } catch (error) {
                    callback(error as Error);
                    return;
                }
                this.#head = [];
            }
        }

        callback(null, chunk);
    }

    override _flush(callback: TransformCallback): void {
        if (this.requireSqliteHeader && !this.#headChecked) {
            callback(new BackupContainerError(
                "not-a-database",
                "Output is too short to be a SQLite database."
            ));
            return;
        }
        callback();
    }

}
