import { webBackend } from "./backend-web.js";
import type { ByteSink, ByteSource } from "./backend.js";
import {
    readContainer,
    type ReadBackupContainerOptions,
    type ReadBackupContainerResult
} from "./read.js";
import {
    type WriteBackupContainerOptions,
    type WriteBackupContainerResult,
    writeContainer
} from "./write.js";

/**
 * Unwraps a container back into a database. The web entry point: takes Web Streams and runs on
 * WebCrypto, the platform's gzip codec and `@noble/hashes`. See {@link readContainer} for the
 * semantics.
 *
 * @param input the container bytes.
 * @param output the destination for the database, which is closed by this call on success and
 *   aborted with the failure otherwise.
 */
export async function readBackupContainer(
    input: ReadableStream<Uint8Array>,
    output: WritableStream<Uint8Array>,
    options: ReadBackupContainerOptions = {}
): Promise<ReadBackupContainerResult> {
    const writer = output.getWriter();
    try {
        return await readContainer(streamSource(input), sinkFor(writer), webBackend, options);
    } catch (error) {
        await abortQuietly(writer, error);
        throw error;
    }
}

/**
 * Wraps a database into a container. The web entry point: takes Web Streams and runs on
 * WebCrypto, the platform's gzip codec and `@noble/hashes`. See {@link writeContainer} for the
 * semantics.
 *
 * @param input the database bytes.
 * @param output the destination, which is closed by this call on success and aborted with the
 *   failure otherwise.
 */
export async function writeBackupContainer(
    input: ReadableStream<Uint8Array>,
    output: WritableStream<Uint8Array>,
    options: WriteBackupContainerOptions
): Promise<WriteBackupContainerResult> {
    const writer = output.getWriter();
    try {
        return await writeContainer(streamSource(input), sinkFor(writer), webBackend, options);
    } catch (error) {
        await abortQuietly(writer, error);
        throw error;
    }
}

/**
 * Iterates a readable stream by hand rather than through its own async iterator, which some
 * engines still lack. Cancels what is left of the stream however the iteration ends, so an
 * abandoned read does not leave the input locked and half-consumed.
 */
async function* streamSource(input: ReadableStream<Uint8Array>): ByteSource {
    const reader = input.getReader();
    try {
        for (;;) {
            const result = await reader.read();
            if (result.done) {
                return;
            }
            yield result.value;
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // An already-errored input refuses the cancel; its error has been dealt with.
        }
    }
}

/** Hands the failure to the destination; a destination that already failed keeps its own error. */
async function abortQuietly(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    error: unknown
): Promise<void> {
    try {
        await writer.abort(error);
    } catch {
        // The destination failed first, which is what is being reported upstream anyway.
    }
}

/** A {@link ByteSink} over a writable stream's writer, honouring its backpressure. */
function sinkFor(writer: WritableStreamDefaultWriter<Uint8Array>): ByteSink {
    return {
        write(chunk) {
            return writer.write(chunk);
        },
        end() {
            return writer.close();
        }
    };
}
