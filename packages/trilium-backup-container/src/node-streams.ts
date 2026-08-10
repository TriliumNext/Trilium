import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";

import { nodeBackend } from "./backend-node.js";
import type { ByteSink } from "./backend.js";
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
 * Unwraps a container back into a database. The Node entry point: takes Node streams and runs on
 * the Node standard library alone. See {@link readContainer} for the semantics.
 *
 * @param input the container bytes.
 * @param output the destination for the database, which is ended by this call.
 */
export async function readBackupContainer(
    input: Readable,
    output: Writable,
    options: ReadBackupContainerOptions = {}
): Promise<ReadBackupContainerResult> {
    try {
        return await readContainer(input, sinkFor(output), nodeBackend, options);
    } catch (error) {
        destroyBoth(input, output);
        throw error;
    }
}

/**
 * Wraps a database into a container. The Node entry point: takes Node streams and runs on the
 * Node standard library alone. See {@link writeContainer} for the semantics.
 *
 * @param input the database bytes.
 * @param output the destination, which is ended by this call.
 */
export async function writeBackupContainer(
    input: Readable,
    output: Writable,
    options: WriteBackupContainerOptions
): Promise<WriteBackupContainerResult> {
    try {
        return await writeContainer(input, sinkFor(output), nodeBackend, options);
    } catch (error) {
        destroyBoth(input, output);
        throw error;
    }
}

/**
 * A {@link ByteSink} over a Node writable. Chunks resolve through `write`'s own callback, so a
 * destination failure surfaces as the destination's own error, exactly where it happened.
 */
function sinkFor(output: Writable): ByteSink {
    // A failing destination reports through the write callback below, but it also emits `error`,
    // which with nobody listening would escalate into an uncaught exception. `pipeline` used to be
    // that listener.
    output.on("error", () => {});

    return {
        write(chunk) {
            return new Promise<void>((resolve, reject) => {
                output.write(chunk, (error) => (error ? reject(error) : resolve()));
            });
        },
        async end() {
            output.end();
            await finished(output);
        }
    };
}

/** What `stream.pipeline` would have done on failure: neither stream is left half-open. */
function destroyBoth(input: Readable, output: Writable): void {
    input.destroy();
    output.destroy();
}
