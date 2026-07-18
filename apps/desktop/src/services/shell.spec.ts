import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `shell.ts` does `import electron from "electron"` at module load to register
// IPC handlers. On CI the `electron` package's entry point throws ("Electron
// failed to install correctly") because the binary isn't materialized. The
// tests below only exercise pure validators, so stub electron with empty
// surface to skip the binary lookup entirely.
vi.mock("electron", () => ({
    default: {
        ipcMain: { on: () => {}, handle: () => {} },
        shell: {},
        app: {}
    }
}));

const {
    validateDownloadUrl,
    validateOpenCustomPath,
    validateOpenExternalUrl,
    validateOpenFileUrl,
    validateOpenPath
} = await import("./shell.js");

//#region validateOpenCustomPath

describe("validateOpenCustomPath", () => {
    let tmpDir: string;
    let validFile: string;
    let hostileFile: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-open-custom-"));
        validFile = path.join(tmpDir, "plain.txt");
        fs.writeFileSync(validFile, "");
        // A filename containing `&` is the original command-injection regression:
        // when the path was interpolated into a cmd.exe string, the `&` chained
        // arbitrary commands. The validator must ACCEPT this filename — the fix
        // is to never route through a shell, not to reject the name.
        hostileFile = path.join(tmpDir, "foo & calc & rem .txt");
        fs.writeFileSync(hostileFile, "");
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("rejects malformed input", () => {
        expect(() => validateOpenCustomPath(undefined, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenCustomPath(null, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenCustomPath(123, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenCustomPath({}, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenCustomPath("", tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenCustomPath(path.join(tmpDir, "foo\0.txt"), tmpDir))
            .toThrow(/invalid filePath/);
    });

    it("rejects paths outside the sandbox", () => {
        const outside = process.platform === "win32" ? "C:\\Windows\\Temp\\evil.txt" : "/etc/passwd";
        expect(() => validateOpenCustomPath(outside, tmpDir)).toThrow(/outside tmpdir/);

        const traversal = path.join(tmpDir, "..", "..", "..", "evil.txt");
        expect(() => validateOpenCustomPath(traversal, tmpDir)).toThrow(/outside tmpdir/);

        expect(() => validateOpenCustomPath("foo.txt", tmpDir)).toThrow(/outside tmpdir/);

        // Sibling-prefix near-miss
        const sibling = tmpDir + "-evil";
        fs.mkdirSync(sibling);
        try {
            const siblingFile = path.join(sibling, "x.txt");
            fs.writeFileSync(siblingFile, "");
            expect(() => validateOpenCustomPath(siblingFile, tmpDir)).toThrow(/outside tmpdir/);
        } finally {
            fs.rmSync(sibling, { recursive: true, force: true });
        }
    });

    it("rejects nonexistent files inside the sandbox", () => {
        const missing = path.join(tmpDir, "does-not-exist.txt");
        expect(() => validateOpenCustomPath(missing, tmpDir)).toThrow(/does not exist/);
    });

    it("accepts valid paths, including filenames with shell metacharacters", () => {
        expect(validateOpenCustomPath(validFile, tmpDir)).toBe(path.resolve(validFile));
        // Regression for the original `cmd.exe` injection vulnerability.
        expect(validateOpenCustomPath(hostileFile, tmpDir)).toBe(path.resolve(hostileFile));
    });

    it.runIf(process.platform === "win32")(
        "matches tmpdir case-insensitively on Windows",
        () => {
            const mixed = validFile.toUpperCase();
            expect(validateOpenCustomPath(mixed, tmpDir)).toBe(path.resolve(mixed));
        }
    );
});

//#endregion

//#region validateOpenPath

describe("validateOpenPath", () => {
    let dataDir: string;
    let tmpDir: string;
    let separateTmpDir: string;
    let dataFile: string;
    let tmpFile: string;
    let separateTmpFile: string;

    beforeAll(() => {
        // Default layout: TMP_DIR is a subdirectory of DATA_DIR.
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-open-path-data-"));
        tmpDir = path.join(dataDir, "tmp");
        fs.mkdirSync(tmpDir);

        // Also simulate the TRILIUM_TMP_DIR-outside-of-data-dir configuration.
        separateTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-open-path-tmp-"));

        dataFile = path.join(dataDir, "config.ini");
        fs.writeFileSync(dataFile, "");
        tmpFile = path.join(tmpDir, "attachment.txt");
        fs.writeFileSync(tmpFile, "");
        separateTmpFile = path.join(separateTmpDir, "attachment.txt");
        fs.writeFileSync(separateTmpFile, "");
    });

    afterAll(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(separateTmpDir, { recursive: true, force: true });
    });

    it("rejects malformed input", () => {
        expect(() => validateOpenPath(undefined, dataDir, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenPath(null, dataDir, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenPath(123, dataDir, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenPath({}, dataDir, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenPath("", dataDir, tmpDir)).toThrow(/invalid filePath/);
        expect(() => validateOpenPath(path.join(dataDir, "foo\0.txt"), dataDir, tmpDir))
            .toThrow(/invalid filePath/);
    });

    it("rejects paths outside the sandbox", () => {
        const outside = process.platform === "win32" ? "C:\\Windows\\Temp\\evil.txt" : "/etc/passwd";
        expect(() => validateOpenPath(outside, dataDir, tmpDir)).toThrow(/outside data dir/);

        const traversal = path.join(dataDir, "..", "..", "..", "evil.txt");
        expect(() => validateOpenPath(traversal, dataDir, tmpDir)).toThrow(/outside data dir/);

        expect(() => validateOpenPath("foo.txt", dataDir, tmpDir)).toThrow(/outside data dir/);

        const sibling = dataDir + "-evil";
        fs.mkdirSync(sibling);
        try {
            const siblingFile = path.join(sibling, "x.txt");
            fs.writeFileSync(siblingFile, "");
            expect(() => validateOpenPath(siblingFile, dataDir, tmpDir)).toThrow(/outside data dir/);
        } finally {
            fs.rmSync(sibling, { recursive: true, force: true });
        }
    });

    it("rejects UNC paths (the NTLM-credential-theft vector)", () => {
        if (process.platform === "win32") {
            expect(() => validateOpenPath("\\\\attacker.example\\share\\x", dataDir, tmpDir))
                .toThrow(/outside data dir/);
        }
    });

    it("rejects nonexistent files inside the sandbox", () => {
        const missing = path.join(dataDir, "does-not-exist.txt");
        expect(() => validateOpenPath(missing, dataDir, tmpDir)).toThrow(/does not exist/);
    });

    it("accepts the data directory itself (About-dialog 'open data directory' case)", () => {
        expect(validateOpenPath(dataDir, dataDir, tmpDir)).toBe(path.resolve(dataDir));
    });

    it("accepts files under the data directory", () => {
        expect(validateOpenPath(dataFile, dataDir, tmpDir)).toBe(path.resolve(dataFile));
    });

    it("accepts files under the tmp dir (default 'TMP_DIR-is-a-subdir' layout)", () => {
        expect(validateOpenPath(tmpFile, dataDir, tmpDir)).toBe(path.resolve(tmpFile));
    });

    it("accepts files under a TRILIUM_TMP_DIR configured outside the data dir", () => {
        expect(validateOpenPath(separateTmpFile, dataDir, separateTmpDir))
            .toBe(path.resolve(separateTmpFile));
    });

    it.runIf(process.platform === "win32")(
        "matches sandbox roots case-insensitively on Windows",
        () => {
            expect(validateOpenPath(dataFile.toUpperCase(), dataDir, tmpDir))
                .toBe(path.resolve(dataFile.toUpperCase()));
        }
    );
});

//#endregion

//#region validateOpenExternalUrl

describe("validateOpenExternalUrl", () => {
    it("rejects malformed input", () => {
        expect(() => validateOpenExternalUrl(undefined)).toThrow(/invalid URL/);
        expect(() => validateOpenExternalUrl(null)).toThrow(/invalid URL/);
        expect(() => validateOpenExternalUrl(123)).toThrow(/invalid URL/);
        expect(() => validateOpenExternalUrl("")).toThrow(/invalid URL/);
    });

    it("rejects strings that don't parse as URLs", () => {
        expect(() => validateOpenExternalUrl("not a url")).toThrow(/not a valid URL/);
        expect(() => validateOpenExternalUrl("example.com")).toThrow(/not a valid URL/);
        expect(() => validateOpenExternalUrl("/relative/path")).toThrow(/not a valid URL/);
    });

    it("rejects known-dangerous OS protocol-handler schemes", () => {
        // Follina (CVE-2022-30190) and friends
        expect(() => validateOpenExternalUrl("ms-msdt:/id PCWDiagnostic"))
            .toThrow(/blocked scheme 'ms-msdt'/);
        expect(() => validateOpenExternalUrl("search-ms:query=x&crumb=location:\\\\evil.example\\share"))
            .toThrow(/blocked scheme 'search-ms'/);
        expect(() => validateOpenExternalUrl("ms-officecmd:%7B%22LocalProviders%22:..."))
            .toThrow(/blocked scheme 'ms-officecmd'/);

        // Script execution
        expect(() => validateOpenExternalUrl("javascript:alert(1)"))
            .toThrow(/blocked scheme 'javascript'/);
        expect(() => validateOpenExternalUrl("vbscript:msgbox(1)"))
            .toThrow(/blocked scheme 'vbscript'/);
    });

    it("rejects schemes explicitly dropped from the openExternal allowlist", () => {
        expect(() => validateOpenExternalUrl("file:///C:/Windows/System32/calc.exe"))
            .toThrow(/blocked scheme 'file'/);
        expect(() => validateOpenExternalUrl("data:text/html,<script>alert(1)</script>"))
            .toThrow(/blocked scheme 'data'/);
        expect(() => validateOpenExternalUrl("smb://attacker.example/share/file"))
            .toThrow(/blocked scheme 'smb'/);
        expect(() => validateOpenExternalUrl("ldap://attacker.example/dc=x"))
            .toThrow(/blocked scheme 'ldap'/);
        expect(() => validateOpenExternalUrl("ldaps://attacker.example/dc=x"))
            .toThrow(/blocked scheme 'ldaps'/);
    });

    it("accepts standard web and communication schemes", () => {
        expect(validateOpenExternalUrl("https://example.com/path").toString())
            .toBe("https://example.com/path");
        expect(validateOpenExternalUrl("http://example.com/").toString())
            .toBe("http://example.com/");
        expect(validateOpenExternalUrl("mailto:user@example.com").toString())
            .toBe("mailto:user@example.com");
        expect(validateOpenExternalUrl("tel:+15551234").toString())
            .toBe("tel:+15551234");
    });

    it("accepts the note-app integration schemes (zotero/obsidian/etc.)", () => {
        expect(() => validateOpenExternalUrl("zotero://select/items/0_ABC")).not.toThrow();
        expect(() => validateOpenExternalUrl("obsidian://open?vault=Notes")).not.toThrow();
        expect(() => validateOpenExternalUrl("logseq://x-callback-url/foo")).not.toThrow();
        expect(() => validateOpenExternalUrl("evernote://x")).not.toThrow();
        expect(() => validateOpenExternalUrl("onenote://x")).not.toThrow();
    });

    it("matches the scheme case-insensitively", () => {
        expect(() => validateOpenExternalUrl("HTTPS://example.com")).not.toThrow();
        expect(() => validateOpenExternalUrl("MS-MSDT:/id x"))
            .toThrow(/blocked scheme 'ms-msdt'/);
    });
});

//#endregion

//#region validateOpenFileUrl

describe("validateOpenFileUrl", () => {
    it("rejects malformed input", () => {
        expect(() => validateOpenFileUrl(undefined)).toThrow(/invalid URL/);
        expect(() => validateOpenFileUrl(null)).toThrow(/invalid URL/);
        expect(() => validateOpenFileUrl(123)).toThrow(/invalid URL/);
        expect(() => validateOpenFileUrl("")).toThrow(/invalid URL/);
    });

    it("rejects strings that don't parse as URLs", () => {
        expect(() => validateOpenFileUrl("not a url")).toThrow(/not a valid URL/);
        expect(() => validateOpenFileUrl("/some/path")).toThrow(/not a valid URL/);
    });

    it("rejects non-file: schemes", () => {
        expect(() => validateOpenFileUrl("https://example.com/foo")).toThrow(/not a file: URL/);
        expect(() => validateOpenFileUrl("smb://attacker.example/share/x"))
            .toThrow(/not a file: URL/);
    });

    it("rejects UNC paths (the NTLM-credential-theft vector)", () => {
        expect(() => validateOpenFileUrl("file://attacker.example/share/x"))
            .toThrow(/UNC path blocked: attacker\.example/);
        expect(() => validateOpenFileUrl("file://192.168.1.1/c$/Windows"))
            .toThrow(/UNC path blocked: 192\.168\.1\.1/);
    });

    it.runIf(process.platform === "win32")(
        "accepts and resolves normal Windows file: URLs",
        () => {
            expect(validateOpenFileUrl("file:///C:/Windows/notepad.exe"))
                .toBe(path.win32.normalize("C:\\Windows\\notepad.exe"));
            // Malformed form some sources emit: file://C:/path (drive letter as host).
            expect(validateOpenFileUrl("file://C:/Windows/notepad.exe"))
                .toBe(path.win32.normalize("C:\\Windows\\notepad.exe"));
        }
    );

    it.runIf(process.platform !== "win32")(
        "accepts and resolves normal POSIX file: URLs",
        () => {
            expect(validateOpenFileUrl("file:///etc/hosts")).toBe("/etc/hosts");
            expect(validateOpenFileUrl("file:///tmp/foo bar")).toBe("/tmp/foo bar");
        }
    );
});

//#endregion

//#region validateDownloadUrl

// Trilium's desktop renderer is served via a custom protocol whose origin is
// opaque per the WHATWG URL spec; this is the realistic page URL in production.
const DESKTOP_PAGE_URL = "trilium-app://app/";
// The web variant uses a plain HTTP origin.
const HTTP_PAGE_URL = "http://localhost:8080/index.html";

describe("validateDownloadUrl", () => {
    it("rejects malformed input", () => {
        expect(() => validateDownloadUrl(undefined, DESKTOP_PAGE_URL)).toThrow(/invalid URL/);
        expect(() => validateDownloadUrl(null, DESKTOP_PAGE_URL)).toThrow(/invalid URL/);
        expect(() => validateDownloadUrl(123, DESKTOP_PAGE_URL)).toThrow(/invalid URL/);
        expect(() => validateDownloadUrl("", DESKTOP_PAGE_URL)).toThrow(/invalid URL/);
    });

    it("rejects strings that don't parse as URLs", () => {
        expect(() => validateDownloadUrl("not a url", DESKTOP_PAGE_URL)).toThrow(/not a valid URL/);
        expect(() => validateDownloadUrl("example.com", DESKTOP_PAGE_URL)).toThrow(/not a valid URL/);
        expect(() => validateDownloadUrl("/relative/path", DESKTOP_PAGE_URL))
            .toThrow(/not a valid URL/);
    });

    it("rejects cross-origin downloads (HTTP renderer)", () => {
        expect(() => validateDownloadUrl("https://attacker.example/malware.exe", HTTP_PAGE_URL))
            .toThrow(/cross-origin download blocked/);
        expect(() => validateDownloadUrl("http://localhost:9090/foo", HTTP_PAGE_URL))
            .toThrow(/cross-origin download blocked/);
        expect(() => validateDownloadUrl("https://localhost:8080/foo", HTTP_PAGE_URL))
            .toThrow(/cross-origin download blocked/);
    });

    it("rejects cross-origin downloads (custom-protocol renderer)", () => {
        expect(() => validateDownloadUrl("https://attacker.example/malware.exe", DESKTOP_PAGE_URL))
            .toThrow(/cross-origin download blocked/);
        expect(() => validateDownloadUrl("trilium-app://attacker/x", DESKTOP_PAGE_URL))
            .toThrow(/cross-origin download blocked/);
    });

    it("rejects URLs without a usable host on either side", () => {
        // data:, file:///, about:, blob: all parse but have empty hostname.
        expect(() => validateDownloadUrl("data:text/plain,hello", DESKTOP_PAGE_URL))
            .toThrow(/hostless URL not allowed/);
        expect(() => validateDownloadUrl("file:///C:/Windows/System32/calc.exe", DESKTOP_PAGE_URL))
            .toThrow(/hostless URL not allowed/);
        expect(() => validateDownloadUrl("about:blank", DESKTOP_PAGE_URL))
            .toThrow(/not a valid URL|hostless URL not allowed/);
        expect(() => validateDownloadUrl("file:///C:/foo", "file:///C:/index.html"))
            .toThrow(/hostless URL not allowed/);
    });

    it("rejects when the allowed origin itself is malformed", () => {
        expect(() => validateDownloadUrl(`${HTTP_PAGE_URL}`, "not a url"))
            .toThrow(/invalid allowed origin/);
        expect(() => validateDownloadUrl(`${HTTP_PAGE_URL}`, ""))
            .toThrow(/invalid allowed origin/);
    });

    it("accepts same-origin downloads via the trilium-app:// custom protocol", () => {
        expect(validateDownloadUrl("trilium-app://app/api/notes/abc/download", DESKTOP_PAGE_URL).toString())
            .toBe("trilium-app://app/api/notes/abc/download");
        expect(validateDownloadUrl("trilium-app://app/api/attachments/xyz/download?123", DESKTOP_PAGE_URL).toString())
            .toBe("trilium-app://app/api/attachments/xyz/download?123");
        expect(validateDownloadUrl("trilium-app://app/api/revisions/r1/download", DESKTOP_PAGE_URL).toString())
            .toBe("trilium-app://app/api/revisions/r1/download");
        expect(validateDownloadUrl("trilium-app://app/api/branches/b1/export/subtree/html/t1", DESKTOP_PAGE_URL).toString())
            .toBe("trilium-app://app/api/branches/b1/export/subtree/html/t1");
    });

    it("accepts same-origin downloads via plain HTTP", () => {
        expect(validateDownloadUrl("http://localhost:8080/api/notes/abc/download", HTTP_PAGE_URL).toString())
            .toBe("http://localhost:8080/api/notes/abc/download");
    });
});

//#endregion
