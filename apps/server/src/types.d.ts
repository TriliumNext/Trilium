/*
 * This file contains type definitions for libraries that did not have one
 * in its library or in `@types/*` packages.
 */

declare module "unescape" {
    function unescape(str: string, type?: string): string;
    export default unescape;
}

declare module "html2plaintext" {
    function html2plaintext(htmlText: string): string;
    export default html2plaintext;
}

declare module "normalize-strings" {
    function normalizeString(string: string): string;
    export default normalizeString;
}

declare module "is-animated" {
    function isAnimated(buffer: Buffer): boolean;
    export default isAnimated;
}

declare module "@triliumnext/ckeditor5/content.css" {
    const content: string;
    export default content;
}


declare module "@triliumnext/share-theme/*.ejs" {
    const content: string;
    export default content;
}

declare module "@triliumnext/share-theme/styles.css" {
    const content: string;
    export default content;
}

declare module "archiver" {
    import { Transform } from "stream";
    import { ZlibOptions } from "zlib";

    interface ArchiverOptions {
        statConcurrency?: number;
        allowHalfOpen?: boolean;
        highWaterMark?: number;
        comment?: string;
        forceLocalTime?: boolean;
        forceZip64?: boolean;
        namePrependSlash?: boolean;
        store?: boolean;
        zlib?: ZlibOptions;
        gzip?: boolean;
        gzipOptions?: ZlibOptions;
    }

    interface EntryData {
        name: string;
        date?: Date | string;
        mode?: number;
        prefix?: string;
    }

    class Archiver extends Transform {
        constructor(options?: ArchiverOptions);
        append(source: NodeJS.ReadableStream | Buffer | string, data?: EntryData): this;
        directory(dirpath: string, destpath: false | string, data?: Partial<EntryData>): this;
        file(filename: string, data: EntryData): this;
        finalize(): Promise<void>;
        pointer(): number;
        pipe<T extends NodeJS.WritableStream>(destination: T): T;
    }

    class ZipArchive extends Archiver {
        constructor(options?: ArchiverOptions);
    }

    class TarArchive extends Archiver {
        constructor(options?: ArchiverOptions);
    }

    export { Archiver, ZipArchive, TarArchive, ArchiverOptions, EntryData };
}

declare module '*.css' {}
declare module '*?raw' {
  const src: string
  export default src
}
