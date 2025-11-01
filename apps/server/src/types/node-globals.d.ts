// Minimal ambient declarations to quiet VS Code red squiggles for Node globals in non-test app builds.
declare const __dirname: string;
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
    VITEST?: string;
    TRILIUM_INTEGRATION_TEST?: string;
    [key: string]: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
    exit(code?: number): never;
    cwd(): string;
    platform: string;
    pid: number;
  }
}
declare const process: NodeJS.Process;

// Full Buffer type declaration to match Node.js Buffer API
declare class Buffer extends Uint8Array {
  static from(value: string | Buffer | Uint8Array | ArrayBuffer | readonly number[], encodingOrOffset?: BufferEncoding | number, length?: number): Buffer;
  static alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
  static isBuffer(obj: any): obj is Buffer;
  static concat(list: Uint8Array[], totalLength?: number): Buffer;
  
  toString(encoding?: BufferEncoding): string;
  equals(otherBuffer: Uint8Array): boolean;
}

type BufferEncoding = "ascii" | "utf8" | "utf-8" | "utf16le" | "utf-16le" | "ucs2" | "ucs-2" | "base64" | "base64url" | "latin1" | "binary" | "hex";
