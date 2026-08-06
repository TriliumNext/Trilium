import type { Readable } from "node:stream";

import { BackupContainerError } from "./errors.js";

/** Pull-based view over a readable stream, so the reader can ask for exact byte counts. */
export class ByteReader {

    readonly #iterator: AsyncIterator<Buffer>;
    #pending: Buffer[] = [];
    #pendingBytes = 0;
    #exhausted = false;
    #consumed = 0;

    constructor(stream: Readable) {
        this.#iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    }

    /** Bytes handed out so far, which is the offset a failure should be reported at. */
    get consumed(): number {
        return this.#consumed;
    }

    /** Reads exactly `count` bytes, or throws `truncated`. */
    async readExactly(count: number): Promise<Buffer> {
        await this.#buffer(count);

        if (this.#pendingBytes < count) {
            throw new BackupContainerError(
                "truncated",
                `Expected ${count} bytes at offset ${this.#consumed}, found ${this.#pendingBytes}.`
            );
        }

        return this.#take(count);
    }

    /** Reads up to `count` bytes, returning fewer at end of input. */
    async readUpTo(count: number): Promise<Buffer> {
        await this.#buffer(count);

        return this.#take(Math.min(count, this.#pendingBytes));
    }

    async atEof(): Promise<boolean> {
        await this.#buffer(1);

        return this.#pendingBytes === 0;
    }

    async #buffer(target: number): Promise<void> {
        while (this.#pendingBytes < target && !this.#exhausted) {
            const next = await this.#iterator.next();
            if (next.done) {
                this.#exhausted = true;
            } else {
                this.#pending.push(next.value);
                this.#pendingBytes += next.value.length;
            }
        }
    }

    #take(count: number): Buffer {
        if (count === 0) {
            return Buffer.alloc(0);
        }

        const merged = this.#pending.length === 1 ? this.#pending[0] : Buffer.concat(
            this.#pending,
            this.#pendingBytes
        );
        const taken = merged.subarray(0, count);
        const rest = merged.subarray(count);

        this.#pending = rest.length > 0 ? [ rest ] : [];
        this.#pendingBytes = rest.length;
        this.#consumed += count;

        return taken;
    }

}
