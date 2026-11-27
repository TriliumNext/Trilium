import type { ZipArchive, ZipEntry } from "@triliumnext/core/src/services/zip_provider.js";
import fs, { mkdtempSync, rmSync, writeFileSync } from "fs";
import type { FileHandle } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { afterAll, describe, expect, it, vi } from "vitest";

import NodejsZipProvider from "./zip_provider.js";

const provider = new NodejsZipProvider();

/** Drains an archive into its finalized bytes, collecting everything written to the pipe. */
function pipeToBuffer(archive: ZipArchive): { sink: PassThrough; bytes: Promise<Buffer> } {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));
    const bytes = new Promise<Buffer>((resolve, reject) => {
        sink.on("end", () => resolve(Buffer.concat(chunks)));
        sink.on("error", reject);
    });
    archive.pipe(sink);
    return { sink, bytes };
}

/** Narrows the optional waitForCapacity to the concrete server implementation, which always defines it. */
function capacityOf(archive: ZipArchive): () => Promise<void> {
    const waitForCapacity = archive.waitForCapacity?.bind(archive);
    if (!waitForCapacity) {
        throw new Error("NodejsZipArchive is expected to implement waitForCapacity()");
    }
    return waitForCapacity;
}

/** Builds an archive from the given entries and returns the finalized zip bytes. */
async function buildZip(entries: { name: string; content: string | Uint8Array }[]): Promise<Buffer> {
    const archive = provider.createZipArchive();
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
        sink.on("end", () => resolve(Buffer.concat(chunks)));
        sink.on("error", reject);
    });

    archive.pipe(sink);
    for (const entry of entries) {
        archive.append(entry.content, { name: entry.name });
    }
    await archive.finalize();
    return done;
}

/** Reads an archive into a `{ fileName -> bytes }` map via the provider's own reader. */
async function readZip(buffer: Buffer): Promise<Record<string, Buffer>> {
    const out: Record<string, Buffer> = {};
    await provider.readZipFile(buffer, async (entry: ZipEntry, readContent) => {
        out[entry.fileName] = Buffer.from(await readContent());
    });
    return out;
}

describe("NodejsZipProvider", () => {
    it("round-trips string content", async () => {
        const buffer = await buildZip([{ name: "note.html", content: "<p>hello</p>" }]);
        const entries = await readZip(buffer);
        expect(entries["note.html"].toString("utf-8")).toBe("<p>hello</p>");
    });

    it("round-trips binary content byte-for-byte", async () => {
        // Non-UTF-8 bytes so any string coercion would corrupt the payload.
        const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x80, 0x01, 0xfe]);
        const buffer = await buildZip([{ name: "pixel.png", content: binary }]);
        const entries = await readZip(buffer);
        expect(Buffer.compare(entries["pixel.png"], Buffer.from(binary))).toBe(0);
    });

    it("appends only the bytes of a sliced Uint8Array view, not its backing buffer", async () => {
        // A view with a non-zero byteOffset over a larger backing buffer. The
        // appended entry must contain exactly the view's slice, never the
        // surrounding bytes of the pool/backing ArrayBuffer.
        const backing = new Uint8Array([0xaa, 0xbb, 0x01, 0x02, 0x03, 0xcc, 0xdd]);
        const view = backing.subarray(2, 5); // [0x01, 0x02, 0x03]
        expect(view.byteOffset).toBe(2);

        const buffer = await buildZip([{ name: "slice.bin", content: view }]);
        const entries = await readZip(buffer);
        expect(Buffer.compare(entries["slice.bin"], Buffer.from([0x01, 0x02, 0x03]))).toBe(0);
    });

    it("reads multiple entries with their decoded file names", async () => {
        const buffer = await buildZip([
            { name: "a.txt", content: "alpha" },
            { name: "dir/b.txt", content: "beta" }
        ]);
        const entries = await readZip(buffer);
        expect(Object.keys(entries).sort()).toEqual(["a.txt", "dir/b.txt"]);
        expect(entries["dir/b.txt"].toString("utf-8")).toBe("beta");
    });

    it("exposes each entry's last-modified date when reading", async () => {
        const buffer = await buildZip([{ name: "a.txt", content: "x" }]);
        let lastModified: Date | undefined;
        await provider.readZipFile(buffer, async (entry: ZipEntry, readContent) => {
            lastModified = entry.lastModified;
            await readContent();
        });
        expect(lastModified).toBeInstanceOf(Date);
    });

    it("stores an entry uncompressed when `store` is set and still round-trips", async () => {
        // Already-compressed payloads pass `store: true` to skip deflate; the bytes must survive intact.
        const archive = provider.createZipArchive();
        const { bytes } = pipeToBuffer(archive);
        const payload = "already-compressed-bytes".repeat(16);
        archive.append(payload, { name: "image.jpg", store: true });
        await archive.finalize();

        const entries = await readZip(await bytes);
        expect(entries["image.jpg"].toString("utf-8")).toBe(payload);
    });

    describe("input backpressure (waitForCapacity)", () => {
        it("resolves immediately when nothing is queued", async () => {
            const archive = provider.createZipArchive();
            await expect(capacityOf(archive)()).resolves.toBeUndefined();
        });

        it("stays pending past the high-water mark until the queued data drains", async () => {
            const archive = provider.createZipArchive();
            const { sink } = pipeToBuffer(archive);
            // PassThrough is paused (no resume yet), so nothing is consumed and the appended entry stays
            // queued. 65 MiB clears the 64 MiB high-water mark.
            archive.append(new Uint8Array(65 * 1024 * 1024), { name: "big.bin" });

            let resolved = false;
            const capacity = capacityOf(archive)().then(() => {
                resolved = true;
            });
            // Still over the mark with nothing consumed — must not have resolved.
            await Promise.resolve();
            expect(resolved).toBe(false);

            // Draining the output fires archiver's "entry" event, dropping queued bytes below the mark.
            sink.resume();
            await capacity;
            expect(resolved).toBe(true);
            await archive.finalize();
        });

        it("re-surfaces an archiver error through append and waitForCapacity", async () => {
            const archive = provider.createZipArchive();
            const { sink } = pipeToBuffer(archive);
            sink.resume();
            await archive.finalize();

            // Appending after finalize makes archiver emit "error" (queue closed); the archive captures it
            // so a missing "error" listener can't crash the process.
            archive.append("late", { name: "late.txt" });
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(() => archive.append("later", { name: "later.txt" })).toThrow();
            await expect(capacityOf(archive)()).rejects.toBeTruthy();
        });

        it("rejects a caller already waiting for capacity when archiver errors", async () => {
            const archive = provider.createZipArchive();
            const { sink } = pipeToBuffer(archive);
            archive.append(new Uint8Array(65 * 1024 * 1024), { name: "big.bin" });
            const capacity = capacityOf(archive)();

            // Appending once finalize() has closed the queue is the error archiver can be made to raise.
            // archiver never settles that finalize() once it has errored, so it is not awaited.
            void archive.finalize();
            archive.append("late", { name: "late.txt" });

            await expect(capacity).rejects.toThrow("queue closed");
            sink.destroy();
        });
    });

    describe("bytes after the central directory", () => {
        const dir = mkdtempSync(join(tmpdir(), "trilium-zip-provider-trailing-spec-"));
        afterAll(() => rmSync(dir, { recursive: true, force: true }));

        let zipCounter = 0;
        function writeTo(buffer: Buffer): string {
            const path = join(dir, `trailing-${zipCounter++}.zip`);
            writeFileSync(path, buffer);
            return path;
        }

        /** Rewrites the comment length in a zip's end-of-central-directory record. */
        function setCommentLength(buffer: Buffer, length: number) {
            buffer.writeUInt16LE(length, buffer.lastIndexOf("PK\x05\x06", buffer.length, "binary") + 20);
        }

        it("reads a zip padded with trailing bytes, from its bytes and from a path alike", async () => {
            // Padding after the record is what several font distributions and download proxies emit; yauzl
            // reads it as the archive comment and refuses the file unless the size it sees is trimmed.
            // Three entries, so the reader has to stay usable across successive entry reads.
            const padded = Buffer.concat([
                await buildZip([
                    { name: "a.txt", content: "alpha" },
                    { name: "b.txt", content: "beta" },
                    { name: "dir/c.txt", content: "gamma" }
                ]),
                Buffer.alloc(24)
            ]);

            const fromBytes = await readZip(padded);
            expect(Object.keys(fromBytes).sort()).toEqual(["a.txt", "b.txt", "dir/c.txt"]);

            const path = writeTo(padded);
            const fromPath: Record<string, Buffer> = {};
            await provider.readZipFile({ path }, async (entry: ZipEntry, readContent) => {
                fromPath[entry.fileName] = Buffer.from(await readContent());
            });
            expect(Object.keys(fromPath).sort()).toEqual(["a.txt", "b.txt", "dir/c.txt"]);
            expect(fromPath["dir/c.txt"].toString("utf-8")).toBe("gamma");
            expect(await provider.detectFilenameEncoding({ path })).toBe(await provider.detectFilenameEncoding(padded));
        });

        it("keeps a genuine archive comment, and trims only the padding that follows it", async () => {
            const comment = Buffer.from("built by trilium");
            const base = await buildZip([{ name: "a.txt", content: "alpha" }]);
            const commented = Buffer.concat([base, comment]);
            setCommentLength(commented, comment.length);
            const padded = Buffer.concat([commented, Buffer.alloc(8)]);
            setCommentLength(padded, comment.length);

            expect((await readZip(commented))["a.txt"].toString("utf-8")).toBe("alpha");
            expect((await readZip(padded))["a.txt"].toString("utf-8")).toBe("alpha");
        });

        it("leaves a zip with no end-of-central-directory record to yauzl to reject", async () => {
            const truncated = (await buildZip([{ name: "a.txt", content: "alpha" }])).subarray(0, 40);
            await expect(readZip(truncated)).rejects.toBeTruthy();
        });
    });

    describe("per-entry size limit", () => {
        const limited = new NodejsZipProvider(64 * 1024);
        const tooLarge = /"zeros\.bin" decompresses to more than 65536 bytes/;

        async function readWithLimit(buffer: Buffer) {
            const out: Record<string, number> = {};
            await limited.readZipFile(buffer, async (entry, readContent) => {
                out[entry.fileName] = (await readContent()).length;
            });
            return out;
        }

        /** Rewrites every central directory record's uncompressed size, as a decompression bomb can. */
        function setDeclaredSizes(buffer: Buffer, size: number) {
            let offset = buffer.indexOf("PK\x01\x02", 0, "binary");
            while (offset !== -1) {
                buffer.writeUInt32LE(size, offset + 24);
                offset = buffer.indexOf("PK\x01\x02", offset + 4, "binary");
            }
        }

        it("reads entries up to the limit and rejects one declared past it", async () => {
            expect(await readWithLimit(await buildZip([{ name: "small.bin", content: new Uint8Array(64 * 1024) }])))
                .toEqual({ "small.bin": 64 * 1024 });
            await expect(readWithLimit(await buildZip([{ name: "zeros.bin", content: new Uint8Array(1024 * 1024) }])))
                .rejects.toThrow(tooLarge);
        });

        it("stops inflating an entry whose declared size understates its content", async () => {
            const bomb = await buildZip([{ name: "zeros.bin", content: new Uint8Array(1024 * 1024) }]);
            setDeclaredSizes(bomb, 16);
            await expect(readWithLimit(bomb)).rejects.toThrow(tooLarge);
        });
    });

    it("rejects a Blob source, which only the browser provider reads", async () => {
        await expect(provider.readZipFile({ blob: new Blob([]) }, async () => {}))
            .rejects.toThrow("A Blob zip source is only readable in the browser.");
    });

    describe("reading from a path (in place, no full-buffer load)", () => {
        const dir = mkdtempSync(join(tmpdir(), "trilium-zip-provider-spec-"));
        afterAll(() => rmSync(dir, { recursive: true, force: true }));

        let zipCounter = 0;
        async function writeZip(entries: { name: string; content: string | Uint8Array }[]): Promise<string> {
            const buffer = await buildZip(entries);
            const path = join(dir, `zip-${zipCounter++}.zip`);
            writeFileSync(path, buffer);
            return path;
        }

        async function readPath(path: string): Promise<Record<string, Buffer>> {
            const out: Record<string, Buffer> = {};
            await provider.readZipFile({ path }, async (entry: ZipEntry, readContent) => {
                out[entry.fileName] = Buffer.from(await readContent());
            });
            return out;
        }

        it("reads entries straight from a file path", async () => {
            const path = await writeZip([
                { name: "a.txt", content: "alpha" },
                { name: "dir/b.txt", content: "beta" }
            ]);
            const entries = await readPath(path);
            expect(Object.keys(entries).sort()).toEqual(["a.txt", "dir/b.txt"]);
            expect(entries["dir/b.txt"].toString("utf-8")).toBe("beta");
        });

        it("yields byte-identical content whether read from a path or its bytes", async () => {
            const binary = new Uint8Array([0x89, 0x50, 0x00, 0xff, 0x80, 0x01]);
            const buffer = await buildZip([{ name: "pixel.png", content: binary }]);
            const path = join(dir, `roundtrip-${zipCounter++}.zip`);
            writeFileSync(path, buffer);

            const fromPath = await readPath(path);
            const fromBytes = await readZip(buffer);
            expect(Buffer.compare(fromPath["pixel.png"], fromBytes["pixel.png"])).toBe(0);
        });

        it("writes an archive to a file stream that reports when it has finished", async () => {
            const path = join(dir, `written-${zipCounter++}.zip`);
            const { destination, waitForFinish } = provider.createFileStream(path);
            const archive = provider.createZipArchive();
            archive.pipe(destination);
            archive.append("alpha", { name: "a.txt" });
            const finished = waitForFinish();
            await archive.finalize();
            await finished;

            expect((await readPath(path))["a.txt"].toString("utf-8")).toBe("alpha");

            const failing = provider.createFileStream(join(dir, "missing-dir", "x.zip"));
            await expect(failing.waitForFinish()).rejects.toThrow(/ENOENT/);
        });

        it("leaves a file too short to hold an end-of-central-directory record to yauzl to reject", async () => {
            const path = join(dir, `tiny-${zipCounter++}.zip`);
            writeFileSync(path, "PK");

            await expect(readPath(path)).rejects.toThrow(/end of central directory record signature not found/i);
        });

        it("closes the file and rethrows when its size cannot be read", async () => {
            const close = vi.fn(async () => undefined);
            const open = vi.spyOn(fs.promises, "open").mockResolvedValue({
                stat: async () => {
                    throw new Error("EIO: i/o error, fstat");
                },
                close
            } as unknown as FileHandle);

            try {
                await expect(provider.detectFilenameEncoding({ path: join(dir, "unreadable.zip") }))
                    .rejects.toThrow("EIO: i/o error, fstat");
                expect(close).toHaveBeenCalledOnce();
            } finally {
                open.mockRestore();
            }
        });

        it("detects the same filename encoding from a path as from the bytes", async () => {
            const buffer = await buildZip([{ name: "plain.txt", content: "x" }]);
            const path = join(dir, `encoding-${zipCounter++}.zip`);
            writeFileSync(path, buffer);

            expect(await provider.detectFilenameEncoding({ path })).toBe(await provider.detectFilenameEncoding(buffer));
        });
    });

    describe("filename encoding", () => {
        it("asks chardet about names not flagged UTF-8, and falls back to UTF-8 without an answer", async () => {
            const detect = vi.fn((_sample: Buffer): string | null => "Shift_JIS");
            vi.doMock("chardet", () => ({ default: { detect } }));
            vi.resetModules();

            try {
                const { default: Provider } = await import("./zip_provider.js");
                const isolated = new Provider();
                const named = await buildZip([ { name: "plain.txt", content: "x" } ]);

                expect(await isolated.detectFilenameEncoding(named)).toBe("Shift_JIS");
                expect(detect.mock.calls[0][0].toString("latin1")).toBe("plain.txt");

                detect.mockClear();
                expect(await isolated.detectFilenameEncoding(await buildZip([]))).toBe("utf-8");
                expect(detect).not.toHaveBeenCalled();

                detect.mockReturnValueOnce(null);
                expect(await isolated.detectFilenameEncoding(named)).toBe("utf-8");

                detect.mockImplementationOnce(() => {
                    throw new Error("chardet failed");
                });
                expect(await isolated.detectFilenameEncoding(named)).toBe("utf-8");
            } finally {
                vi.doUnmock("chardet");
                vi.resetModules();
            }
        });

        it("reads names flagged UTF-8 as UTF-8, whatever encoding was detected for the rest", async () => {
            const zip = await buildZip([ { name: "café.txt", content: "x" } ]);
            const names: string[] = [];
            await provider.readZipFile(zip, async (entry) => {
                names.push(entry.fileName);
            }, "Shift_JIS");

            expect(names).toEqual([ "café.txt" ]);
            expect(await provider.detectFilenameEncoding(zip)).toBe("utf-8");
        });

        it("reads names as UTF-8 when the detected encoding is one TextDecoder does not know", async () => {
            const names: string[] = [];
            await provider.readZipFile(await buildZip([ { name: "plain.txt", content: "x" } ]), async (entry) => {
                names.push(entry.fileName);
            }, "x-no-such-encoding");

            expect(names).toEqual([ "plain.txt" ]);
        });
    });
});
