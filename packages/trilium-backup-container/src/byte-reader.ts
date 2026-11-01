import type { ByteSource } from "./backend.js";
import { concatBytes } from "./bytes.js";
import { BackupContainerError } from "./errors.js";

const EMPTY = new Uint8Array(0);

/** Pull-based view over a byte source, so the reader can ask for exact byte counts. */
export class ByteReader {

    readonly #iterator: AsyncIterator<Uint8Array>;
    #pending: Uint8Array[] = [];
    #pendingBytes = 0;
    #exhausted = false;
    #consumed = 0;

    constructor(source: ByteSource) {
        this.#iterator = source[Symbol.asyncIterator]();
    }

    /** Bytes handed out so far, which is the offset a failure should be reported at. */
    get consumed(): number {
        return this.#consumed;
    }

    /** Reads exactly `count` bytes, or throws `truncated`. */
    async readExactly(count: number): Promise<Uint8Array> {
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
    async readUpTo(count: number): Promise<Uint8Array> {
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

    #take(count: number): Uint8Array {
        if (count === 0) {
            return EMPTY;
        }

        const merged = this.#pending.length === 1
            ? this.#pending[0]
            : concatBytes(...this.#pending);
        const taken = merged.subarray(0, count);
        const rest = merged.subarray(count);

        this.#pending = rest.length > 0 ? [ rest ] : [];
        this.#pendingBytes = rest.length;
        this.#consumed += count;

        return taken;
    }

}
