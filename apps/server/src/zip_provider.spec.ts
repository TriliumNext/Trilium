import type { ZipArchive, ZipEntry } from "@triliumnext/core/src/services/zip_provider.js";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { afterAll, describe, expect, it } from "vitest";

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

        it("detects the same filename encoding from a path as from the bytes", async () => {
            const buffer = await buildZip([{ name: "plain.txt", content: "x" }]);
            const path = join(dir, `encoding-${zipCounter++}.zip`);
            writeFileSync(path, buffer);

            expect(await provider.detectFilenameEncoding({ path })).toBe(await provider.detectFilenameEncoding(buffer));
        });
    });
});
