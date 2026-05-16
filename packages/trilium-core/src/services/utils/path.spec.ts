import { describe, it, expect } from "vitest";
import { extname, basename } from "./path";

describe("#extname", () => {
    const testCases: [input: string, expected: string][] = [
        ["file.txt", ".txt"],
        ["file.tar.gz", ".gz"],
        ["file", ""],
        [".hidden", ""],
        [".hidden.txt", ".txt"],
        ["no-ext.", "."],
        ["path/to/file.ts", ".ts"],
        ["path\\to\\file.ts", ".ts"],
        ["path/to/.gitignore", ""],
        ["", ""],
    ];

    testCases.forEach(([input, expected]) => {
        it(`'${input}' should return '${expected}'`, () => {
            expect(extname(input)).toBe(expected);
        });
    });
});

describe("#basename", () => {
    const testCases: [input: string, expected: string][] = [
        ["path/to/file.txt", "file.txt"],
        ["path\\to\\file.txt", "file.txt"],
        ["file.txt", "file.txt"],
        ["/root/file", "file"],
        ["C:\\Users\\test\\file.md", "file.md"],
        ["path/to/dir/", ""],
        ["", ""],
    ];

    testCases.forEach(([input, expected]) => {
        it(`'${input}' should return '${expected}'`, () => {
            expect(basename(input)).toBe(expected);
        });
    });
});
