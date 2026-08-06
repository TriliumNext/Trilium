import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBackupContainer } from "./read.js";
import { fakeDatabase, FAST_SCRYPT } from "./test-helpers.js";
import { writeBackupContainer } from "./write.js";

/** Exercises the file destination from the module docs, including the out-of-order digest patch. */
describe("file destination", () => {
    let directory = "";

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), "backup-container-"));
    });

    afterAll(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it("writes to a file, patches the digest, and reads back byte for byte", async () => {
        const database = fakeDatabase(3 * 1024 * 1024);
        const source = join(directory, "document.db");
        const partial = join(directory, "backup.part");
        const container = join(directory, "backup");
        const restored = join(directory, "restored.db");
        await writeFile(source, database);

        const output = createWriteStream(partial);
        const result = await writeBackupContainer(createReadStream(source), output, {
            compress: true,
            passphrase: "file test",
            scrypt: FAST_SCRYPT,
            plaintextSize: (await stat(source)).size,
            patchHeader: async (offset, data) => {
                const handle = await open(partial, "r+");
                try {
                    await handle.write(data, 0, data.length, offset);
                    await handle.sync();
                } finally {
                    await handle.close();
                }
            }
        });

        expect(result).toMatchObject({ headerLength: 108, compressed: true, encrypted: true });

        await rename(partial, container);
        expect((await stat(container)).size).toBeLessThan(database.length);

        const restoredOutput = createWriteStream(restored);
        const info = await readBackupContainer(createReadStream(container), restoredOutput, {
            passphrase: "file test"
        });

        expect(info).toMatchObject({
            compressed: true,
            encrypted: true,
            bytesWritten: database.length
        });
        expect((await readFile(restored)).equals(database)).toBe(true);
    });
});
