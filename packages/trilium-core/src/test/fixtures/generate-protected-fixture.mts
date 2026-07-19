/*
 * Generates document_v214_protected.db (+ .manifest.json) from document_v214.db.
 *
 * The protected fixture is the same v214 (pre-blobs schema) database with EVERY note protected:
 * all titles and all note_contents encrypted with a fixed, known data key, simulating a user who
 * ran "protect subtree" over their whole tree (including the hidden subtree) before upgrading.
 * It backs the "migrates from v214 with all notes protected" spec in services/migration.spec.ts.
 *
 * The original fixture's password is unknown, but since it contains no protected notes the
 * credentials can simply be replaced: new salts, a verification hash for the password below, and
 * an encryptedDataKey wrapping the fixed data key. The encryption scheme mirrors
 * services/encryption/data_encryption.ts (AES-128-CBC, 16-byte random IV, 4-byte SHA-1 digest
 * prefix, base64 output) — it is deliberately reimplemented here on top of node:crypto so the
 * generator stays a standalone script that does not need the core platform initialized.
 *
 * entity_changes hashes are intentionally left stale — the migration path never verifies them and
 * recomputing them is not worth coupling this script to the sync hash implementation.
 *
 * Regenerate with:
 *   npx tsx packages/trilium-core/src/test/fixtures/generate-protected-fixture.mts
 *
 * Note: the output is not byte-reproducible (encryption IVs are random), but it is
 * content-equivalent across runs; the manifest captures the plaintext for verification.
 */

import Database from "better-sqlite3";
import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE = join(__dirname, "document_v214.db");
const TARGET = join(__dirname, "document_v214_protected.db");
const MANIFEST = join(__dirname, "document_v214_protected.manifest.json");

// Known credentials of the generated fixture; mirrored in migration.spec.ts.
const PASSWORD = "demo1234";
const DATA_KEY = Buffer.from("0123456789abcdef", "utf8"); // exactly 16 bytes
const VERIFICATION_SALT = "protectedFixtureVerificationSalt";
const DERIVED_KEY_SALT = "protectedFixtureDerivedKeySalt";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

// --- mirror of data_encryption.encrypt ---

function pad(data: Buffer): Buffer {
    if (data.length > 16) {
        return data.subarray(0, 16);
    }
    if (data.length < 16) {
        return Buffer.concat([data, Buffer.alloc(16 - data.length)]);
    }
    return data;
}

function encrypt(key: Buffer, plainText: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-cbc", pad(key), pad(iv));
    const digest = createHash("sha1").update(plainText).digest().subarray(0, 4);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([digest, plainText])), cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString("base64");
}

// --- generation ---

copyFileSync(SOURCE, TARGET);
const db = new Database(TARGET);

// Replace the (unknown) password with the known one and wrap the fixed data key with it,
// mirroring scrypt.ts getVerificationHash/getPasswordDerivedKey and password_encryption.setDataKey.
const verificationHash = scryptSync(PASSWORD, VERIFICATION_SALT, 32, SCRYPT_OPTIONS).toString("base64");
const derivedKey = scryptSync(PASSWORD, DERIVED_KEY_SALT, 32, SCRYPT_OPTIONS);
const encryptedDataKey = encrypt(derivedKey, DATA_KEY);

const setOption = db.prepare("UPDATE options SET value = ? WHERE name = ?");
setOption.run(VERIFICATION_SALT, "passwordVerificationSalt");
setOption.run(DERIVED_KEY_SALT, "passwordDerivedKeySalt");
setOption.run(verificationHash, "passwordVerificationHash");
setOption.run(encryptedDataKey, "encryptedDataKey");

// Protect every note: encrypt the title and the content, exactly as the v214-era code stored
// protected notes (base64 ciphertext in the TEXT columns).
interface ManifestEntry {
    title: string;
    contentSha256: string;
    contentLength: number;
}
const manifestNotes: Record<string, ManifestEntry> = {};

const updateNote = db.prepare("UPDATE notes SET isProtected = 1, title = ? WHERE noteId = ?");
const updateContent = db.prepare("UPDATE note_contents SET content = ? WHERE noteId = ?");

const notes = db.prepare("SELECT noteId, title FROM notes").all() as { noteId: string; title: string }[];
const contents = db.prepare("SELECT noteId, content FROM note_contents").all() as { noteId: string; content: string | Buffer | null }[];
const contentByNoteId = new Map(contents.map((row) => [row.noteId, row.content]));

const transaction = db.transaction(() => {
    for (const note of notes) {
        updateNote.run(encrypt(DATA_KEY, Buffer.from(note.title, "utf8")), note.noteId);

        const content = contentByNoteId.get(note.noteId) ?? Buffer.alloc(0);
        const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf8") : (content ?? Buffer.alloc(0));
        updateContent.run(encrypt(DATA_KEY, contentBuffer), note.noteId);

        manifestNotes[note.noteId] = {
            title: note.title,
            contentSha256: createHash("sha256").update(contentBuffer).digest("hex"),
            contentLength: contentBuffer.length
        };
    }
});
transaction();

// Sanity check within the old schema: everything is protected now.
const unprotected = db.prepare("SELECT count(*) FROM notes WHERE isProtected = 0").pluck().get();
if (unprotected !== 0) {
    throw new Error(`Generation failed: ${unprotected} notes left unprotected`);
}

db.close();

writeFileSync(
    MANIFEST,
    `${JSON.stringify(
        {
            password: PASSWORD,
            dataKeyUtf8: DATA_KEY.toString("utf8"),
            noteCount: notes.length,
            notes: manifestNotes
        },
        null,
        4
    )}\n`
);

console.log(`Generated ${TARGET} (${notes.length} notes protected) and manifest.`);
