/**
 * A zip to read: either its raw bytes, or — server/desktop only — a filesystem path the provider opens
 * and reads *in place* (no full-buffer copy, no ~2 GiB `fs.readFile` ceiling). The browser/WASM provider
 * only supports the byte form.
 */
export type ZipSource = Uint8Array | { path: string };

export interface ZipEntry {
    fileName: string;
    /**
     * The entry's last-modification time, when the provider can read it (the server's reader does; the
     * standalone/WASM reader currently can't, so it's left undefined). ZIP carries no reliable creation time.
     */
    lastModified?: Date;
}

export interface ZipArchiveEntryOptions {
    name: string;
    date?: Date;
    /**
     * Store the entry uncompressed (ZIP STORE method) instead of deflating it.
     * Set for already-compressed payloads (JPEG/PNG, video, PDFs, zip-based
     * office docs…) where zlib spends CPU for ~0% size reduction. Providers that
     * can't control per-entry compression may ignore it.
     */
    store?: boolean;
}

export interface ZipArchive {
    append(content: string | Uint8Array, options: ZipArchiveEntryOptions): void;
    pipe(destination: unknown): void;
    finalize(): Promise<void>;
    /**
     * Resolves once the volume of appended-but-not-yet-written data has dropped
     * below the provider's high-water mark. Lets the export loop apply
     * backpressure on the *input* side, so a multi-GB archive isn't fully read
     * into memory before draining begins. Optional: providers that buffer the
     * whole archive anyway (the WASM/browser provider) can omit it.
     */
    waitForCapacity?(): Promise<void>;
}

export interface FileStream {
    /** An opaque writable destination that can be passed to {@link ZipArchive.pipe}. */
    destination: unknown;
    /** Resolves when the stream has finished writing (or rejects on error). */
    waitForFinish(): Promise<void>;
}

export interface ZipProvider {
    /**
     * Detects the filename encoding used in a ZIP by collecting all non-UTF-8-flagged entry names and
     * running charset detection on them. Returns the detected encoding label (usable with TextDecoder),
     * or "utf-8" as fallback. Accepts raw bytes or — server/desktop only — a {@link ZipSource} path.
     */
    detectFilenameEncoding(source: ZipSource): Promise<string>;

    /**
     * Iterates over every entry in a ZIP, calling `processEntry` for each one. `readContent()` inside the
     * callback reads the raw bytes of that entry on demand. If `filenameEncoding` is provided,
     * non-UTF-8-flagged filenames are decoded using it. Accepts raw bytes or — server/desktop only — a
     * {@link ZipSource} path, in which case the zip is read straight from disk per entry.
     */
    readZipFile(
        source: ZipSource,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void>;

    createZipArchive(): ZipArchive;

    /** Creates a writable file stream for the given path. */
    createFileStream(filePath: string): FileStream;
}

let zipProvider: ZipProvider | null = null;

export function initZipProvider(provider: ZipProvider) {
    zipProvider = provider;
}

export function getZipProvider(): ZipProvider {
    if (!zipProvider) throw new Error("ZipProvider not initialized.");
    return zipProvider;
}
