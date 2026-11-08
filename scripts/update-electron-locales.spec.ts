import { describe, expect, it } from "vitest";

import {
    collectElectronLocales,
    readCentralDirectoryNames,
    readEndOfCentralDirectory
} from "./update-electron-locales.js";

describe("readCentralDirectoryNames", () => {
    it("lists the names of every record, skipping extra fields and comments", () => {
        const names = [ "locales/da.pak", "LICENSE" ];
        const directory = centralDirectory(names, { extra: 4, comment: 3 });

        expect(readCentralDirectoryNames(directory)).toEqual(names);
    });

    it("rejects a directory that ends in a truncated record", () => {
        const directory = centralDirectory([ "locales/da.pak" ]);

        expect(() => readCentralDirectoryNames(directory.subarray(0, directory.length - 2)))
            .toThrow(/unreadable record/);
    });
});

describe("readEndOfCentralDirectory", () => {
    it("finds the record behind a zip comment", () => {
        const tail = concat(
            new Uint8Array(10), endOfCentralDirectory(1234, 56, 5), new Uint8Array(5)
        );

        expect(readEndOfCentralDirectory(tail)).toEqual({ offset: 1234, size: 56 });
    });

    it("refuses ZIP64 archives and data without a record", () => {
        expect(() => readEndOfCentralDirectory(endOfCentralDirectory(0xffffffff, 56)))
            .toThrow(/ZIP64/);
        expect(() => readEndOfCentralDirectory(new Uint8Array(64))).toThrow(/not a zip/);
    });
});

describe("collectElectronLocales", () => {
    const framework
        = "Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources";

    it("picks the locale files out of each platform's entries", () => {
        const locales = collectElectronLocales("45.0.0", {
            linux: [ "locales/", "locales/en-US.pak", "locales/da.pak", "resources.pak" ],
            win32: [ "locales/da.pak", "locales/sub/x.pak" ],
            darwin: [
                "Electron.app/Contents/Resources/da.lproj/",
                "Electron.app/Contents/Resources/da.lproj/locale.pak",
                "Electron.app/Contents/Resources/electron.icns",
                `${framework}/da_FEMININE.lproj/locale.pak`,
                `${framework}/da.lproj/locale.pak`
            ]
        });

        expect(locales).toEqual({
            electronVersion: "45.0.0",
            linux: [ "da.pak", "en-US.pak" ],
            win32: [ "da.pak" ],
            darwin: {
                resources: [ "da.lproj" ],
                frameworkResources: [ "da.lproj", "da_FEMININE.lproj" ]
            }
        });
    });

    it("names every platform that yields no locale files", () => {
        expect(() => collectElectronLocales("45.0.0", {
            linux: [ "locales/da.pak" ],
            win32: [],
            darwin: [ "Electron.app/Contents/Resources/da.lproj/" ]
        })).toThrow(/Electron 45\.0\.0 zips for: win32, darwin framework resources$/);
    });
});

/** Central directory records for `names`, with zeroed fields apart from the lengths. */
function centralDirectory(names: string[], { extra = 0, comment = 0 } = {}): Uint8Array {
    const encoder = new TextEncoder();
    return concat(...names.map((name) => {
        const encodedName = encoder.encode(name);
        const record = new Uint8Array(46 + encodedName.length + extra + comment);
        const view = new DataView(record.buffer);
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(28, encodedName.length, true);
        view.setUint16(30, extra, true);
        view.setUint16(32, comment, true);
        record.set(encodedName, 46);
        return record;
    }));
}

function endOfCentralDirectory(offset: number, size: number, commentLength = 0): Uint8Array {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint32(12, size, true);
    view.setUint32(16, offset, true);
    view.setUint16(20, commentLength, true);
    return record;
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let position = 0;
    for (const part of parts) {
        result.set(part, position);
        position += part.length;
    }
    return result;
}
