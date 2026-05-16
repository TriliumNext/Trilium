export interface ZipEntry {
    fileName: string;
}

export interface ZipArchiveEntryOptions {
    name: string;
    date?: Date;
}

export interface ZipArchive {
    append(content: string | Uint8Array, options: ZipArchiveEntryOptions): void;
    pipe(destination: unknown): void;
    finalize(): Promise<void>;
}

export interface FileStream {
    /** An opaque writable destination that can be passed to {@link ZipArchive.pipe}. */
    destination: unknown;
    /** Resolves when the stream has finished writing (or rejects on error). */
    waitForFinish(): Promise<void>;
}

export interface ZipProvider {
    /**
     * Detects the filename encoding used in a ZIP file by collecting all
     * non-UTF-8-flagged entry names and running charset detection on them.
     * Returns the detected encoding label (usable with TextDecoder), or "utf-8" as fallback.
     */
    detectFilenameEncoding(buffer: Uint8Array): Promise<string>;

    /**
     * Iterates over every entry in a ZIP buffer, calling `processEntry` for each one.
     * `readContent()` inside the callback reads the raw bytes of that entry on demand.
     * If `filenameEncoding` is provided, non-UTF-8-flagged filenames are decoded using it.
     */
    readZipFile(
        buffer: Uint8Array,
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
