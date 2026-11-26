import { cls } from "@triliumnext/core";
import crypto from "crypto";
import type { Request } from "express";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import totpRoute from "../../routes/api/totp.js";
import totp from "../totp.js";
import { getKeyFilePath, isSealed, open, seal } from "./second_factor_key.js";

// Spec files run in parallel and share the key file of `spec/db`, so this one gets its own.
const dataDir = await vi.hoisted(async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return mkdtempSync(join(tmpdir(), "trilium-key-file-"));
});
vi.mock("../data_dir.js", () => ({ default: { TRILIUM_DATA_DIR: dataDir } }));

const FIELD = "totpEncryptedSecret";

describe("the key file of the second factor", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(getKeyFilePath(), { force: true });
    });

    afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    it("opens nothing without the key file", () => {
        const sealed = seal(FIELD, "the secret");
        fs.rmSync(getKeyFilePath());

        expect(open(FIELD, sealed)).toBeNull();
    });

    it("creates the key file once, readable only by the server's user, and keeps it", () => {
        const sealed = seal(FIELD, "the secret");
        const key = fs.readFileSync(getKeyFilePath(), "ascii");
        expect(Buffer.from(key, "base64")).toHaveLength(32);
        if (process.platform !== "win32") {
            expect(fs.statSync(getKeyFilePath()).mode & 0o777).toBe(0o600);
        }

        expect(isSealed(seal(FIELD, "another secret"))).toBe(true);
        expect(fs.readFileSync(getKeyFilePath(), "ascii")).toBe(key);
        expect(open(FIELD, sealed)).toBe("the secret");
    });

    it("refuses to seal with a key file that it cannot read, and opens nothing with it", () => {
        const sealed = seal(FIELD, "the secret");
        fs.writeFileSync(getKeyFilePath(), Buffer.alloc(16).toString("base64"));

        expect(() => seal(FIELD, "the secret")).toThrow(/cannot be read/);
        expect(open(FIELD, sealed)).toBeNull();
    });

    it("lets an enrollment set aside a key file that it cannot read, never a readable one", () => {
        const secret = "JBSWY3DPEHPK3PXP";
        const enroll = () => cls.init(() => totpRoute.enableSecret({
            body: { secret, recoveryCodes: [ "recovery-code" ] }
        } as unknown as Request));
        const setAside = () => fs.readdirSync(dataDir)
            .filter((name) => name.startsWith("second_factor_key.unreadable-"))
            .map((name) => fs.readFileSync(path.join(dataDir, name), "ascii"));

        try {
            enroll();
            const key = fs.readFileSync(getKeyFilePath(), "ascii");
            enroll();
            expect(fs.readFileSync(getKeyFilePath(), "ascii")).toBe(key);
            expect(setAside()).toEqual([]);

            fs.writeFileSync(getKeyFilePath(), "truncated");
            expect(enroll).not.toThrow();
            expect(totp.getTotpSecret()).toBe(secret);
            expect(setAside()).toEqual([ "truncated" ]);
        } finally {
            cls.init(() => totp.resetTotp());
        }
    });

    it("passes on an error other than a key file that another process wrote first", () => {
        vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
            throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        });

        expect(() => seal(FIELD, "the secret")).toThrow("permission denied");
    });

    it("opens nothing whose tag fits but whose padding does not decrypt", () => {
        seal(FIELD, "creates the key file");
        const key = Buffer.from(fs.readFileSync(getKeyFilePath(), "ascii").trim(), "base64");
        const derive = (label: string) =>
            crypto.createHmac("sha256", key).update(label, "utf-8").digest().subarray(0, 16);

        // A block of zeros ends in the padding byte 0, which PKCS#7 refuses.
        const iv = crypto.randomBytes(16);
        const encryptionKey = derive("trilium:second-factor-key:v1");
        const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
        cipher.setAutoPadding(false);
        const cipherText = Buffer.concat([ cipher.update(Buffer.alloc(16)), cipher.final() ]);
        const hmac = crypto.createHmac("sha256", derive("trilium:second-factor-mac:v1"));
        for (const part of [ Buffer.from(FIELD, "utf-8"), iv, cipherText ]) {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(part.length);
            hmac.update(length).update(part);
        }
        const tag = hmac.digest().subarray(0, 16);

        const forged = `sealed1:${Buffer.concat([ iv, cipherText, tag ]).toString("base64")}`;
        expect(open(FIELD, forged)).toBeNull();
        expect(open(FIELD, "not sealed")).toBeNull();
    });
});
