/**
 * OPFS synchronous file access, which TypeScript keeps in `lib.webworker` — unusable here because
 * this project also compiles window-side code against `dom`, and the two libs cannot be mixed.
 * Declared by hand instead, mirroring `lib.webworker`, and only as much of it as the worker code
 * touches (the log service and the backup writer). The API itself exists only in dedicated
 * workers, which is where both run.
 */

interface FileSystemReadWriteOptions {
    at?: number;
}

interface FileSystemSyncAccessHandle {
    close(): void;
    flush(): void;
    getSize(): number;
    read(buffer: AllowSharedBufferSource, options?: FileSystemReadWriteOptions): number;
    truncate(newSize: number): void;
    write(buffer: AllowSharedBufferSource, options?: FileSystemReadWriteOptions): number;
}

interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
