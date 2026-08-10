# @triliumnext/backup-container

Reads and writes the Trilium backup container: one SQLite database wrapped in a small binary envelope,
with optional gzip compression and optional AES-256-GCM encryption. It exists so a database backup can
be made smaller and unreadable to anyone else who can see the folder it is written to, which matters
most when that folder is synced to the cloud. Both directions stream, so a multi-gigabyte database is
never held in memory, and the reader authenticates every chunk before handing any of it to the
destination. The module contains no user-facing strings and ships two entry points over one shared
format layer: the root entry for Node, which depends on nothing outside the Node standard library,
and `@triliumnext/backup-container/web` for browsers. A container written by either is read by both.

## Reading a container

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { readBackupContainer } from "@triliumnext/backup-container";

const info = await readBackupContainer(
    createReadStream(containerPath),
    createWriteStream(databasePath),
    { passphrase }                       // only needed when the container is encrypted
);

console.log(info);
// { version: 1, compressed: true, encrypted: true, plaintextSize: 3145728, bytesWritten: 3145728 }
```

A wrong passphrase is reported immediately, before any frame is read. Useful extras: `maxOutputBytes`
caps what may be written, `requireSqliteHeader: false` allows wrapping something that is not a
database, and `skipVerifier: true` is a recovery path for a container whose verifier tag is damaged.

## Writing a container

The payload digest is only known once the payload has been written, so the caller supplies
`patchHeader` to write it into the header afterwards.

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, stat } from "node:fs/promises";
import { writeBackupContainer } from "@triliumnext/backup-container";

await writeBackupContainer(createReadStream(source), createWriteStream(partial), {
    compress: true,
    passphrase,                          // omit to leave the container unencrypted
    plaintextSize: (await stat(source)).size,
    patchHeader: async (offset, data) => {
        const handle = await open(partial, "r+");
        try {
            await handle.write(data, 0, data.length, offset);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }
});

await rename(partial, destination);      // rename last, so a partial file never looks finished
```

Write to a temporary name and rename on success. Do not hand the payload stream a `FileHandle` opened
with `autoClose: false` and patch through that same handle: its `close()` then waits forever on a
stream that never emits `close`.

## Using it in a browser

`@triliumnext/backup-container/web` exposes the same two operations on Web Streams instead of Node
streams, with the same options, results and errors. AES-256-GCM and randomness come from WebCrypto,
gzip from the platform's `CompressionStream`, and the two primitives WebCrypto does not offer,
scrypt and incremental SHA-256, from [`@noble/hashes`](https://github.com/paulmillr/noble-hashes),
the entry point's only dependency. The Node entry point never loads it.

```ts
import { readBackupContainer } from "@triliumnext/backup-container/web";

const handle = await directory.getFileHandle("document.db", { create: true });
const info = await readBackupContainer(file.stream(), await handle.createWritable(), {
    passphrase,
    onProgress: (progress) => report(Math.round(progress * 100))
});
```

Three platform limits are worth knowing. WebCrypto's `subtle` interface only exists in secure
contexts (HTTPS, localhost, workers of either), so encrypted containers cannot be handled on a page
served over plain HTTP. `CompressionStream` takes no compression level, so `compressionLevel` is
ignored and the platform default applies; the header normalisation keeps the output canonical
regardless. And `patchHeader` still needs random access to the finished bytes, which OPFS provides
(`write` with `at`) but a streamed download does not, so writing a container means staging it
somewhere seekable first. Key derivation is pure JavaScript here and takes seconds rather than
milliseconds at the default cost; run it in a worker and say so in the UI.

## Reporting progress

Both directions accept `onProgress`, which is called with a number from 0 to 1 at most once every
`progressIntervalMs` (250 by default), and once more with exactly 1 when the container is finished.

```ts
await readBackupContainer(input, output, {
    passphrase,
    onProgress: (progress) => report(Math.round(progress * 100))
});
```

Progress is measured on the database and never on the payload: the writer reports how much of the
database has gone in, and the reader reports how much has come out, so a compressed container does not
report a fraction of the progress along with a fraction of the size. A fraction needs a total, which is
the `plaintextSize` the writer records in the header, so a container written without one is read back
reporting nothing but the final 1.

Reports are throttled rather than debounced, since a container streams from beginning to end without
ever pausing. Two things are outside them: key derivation, which is the slow part of opening an
encrypted container and happens before the first byte is read, and success. A report of 1 says the
payload has gone past, not that the destination took it, and the resolved promise is what says the
container is written or unwrapped.

## Catching errors

Every failure is a `BackupContainerError` carrying a `reason`. The message is fixed English for logs;
anything shown to a user should be chosen from the reason.

```ts
import { isBackupContainerError, readBackupContainer } from "@triliumnext/backup-container";

try {
    await readBackupContainer(input, output, { passphrase });
} catch (error) {
    if (isBackupContainerError(error)) {
        switch (error.reason) {
            case "wrong-passphrase-or-damaged-header": return t("backup.wrong_passphrase");
            case "digest-mismatch":
            case "damaged-payload": return t("backup.damaged");
            default: return t("backup.unreadable");
        }
    }
    throw error;                         // a full disk, a missing file: not ours
}
```

The ones worth handling by name:

| Reason | Meaning |
| --- | --- |
| `not-a-container` | The file does not start with the magic, so it is something else entirely |
| `passphrase-required` | The container is encrypted and no passphrase was given |
| `wrong-passphrase-or-damaged-header` | The verifier tag did not match. A wrong passphrase, or a damaged header, and the two cannot be told apart from the tag alone |
| `damaged-payload` | A frame failed authentication, or a compressed payload could not be decoded |
| `digest-mismatch` | The payload does not match the digest recorded in the header, i.e. bit rot |
| `truncated` | The file ends before the container does |
| `trailing-data` | Bytes follow the final frame |
| `not-a-database` | The unwrapped payload is not a SQLite database |
| `output-too-large` | Output hit the ceiling, which is how a crafted compressed payload is stopped |
| `unsupported-version` | Written by a newer Trilium |
| `invalid-options` | The caller's options are unusable, e.g. a missing `patchHeader` |

The full set is the `BackupContainerErrorReason` union.

## Format

Version 1. All integers are little-endian unless noted, and all offsets are absolute.

### Header

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 20 | Magic, ASCII `Trilium Notes Backup` |
| 20 | 1 | Version, `1`. Version `0` is never valid |
| 21 | 1 | Flags. Bit 0 gzip, bit 1 encrypted, bits 2 to 7 reserved and must be 0 |
| 22 | 2 | Header length, i.e. where the payload starts |
| 24 | 8 | Plaintext size before compression, or 0 when unknown |

When the encrypted flag is set, these follow:

| Offset | Size | Field |
| --- | --- | --- |
| 32 | 1 | KDF id, `1` for scrypt |
| 33 | 3 | KDF parameters, for scrypt `log2(N)`, `r`, `p` |
| 36 | 16 | Salt, fresh per file |
| 52 | 8 | Nonce prefix, fresh per file |
| 60 | 16 | Verifier tag |

The last 32 bytes of the header are always the payload digest, a SHA-256 over the payload exactly as
stored. So the header is **64 bytes** unencrypted and **108 bytes** encrypted.

### Payload

| Flags | Payload |
| --- | --- |
| Neither | Raw database bytes |
| Compressed | A single RFC 1952 gzip stream |
| Encrypted | A sequence of frames |
| Both | Frames whose plaintext is the gzip stream |

Compression happens before encryption. The gzip stream is written with MTIME 0, no FNAME or FEXTRA and
OS 255, so it carries no timestamp or platform hint. An unencrypted compressed payload is therefore an
ordinary gzip stream starting at offset 64, recoverable with stock tools.

### Frames

```
frame := length (4 bytes, LE) || data (length bytes) || tag (16 bytes)
```

Bits 0 to 30 of `length` are the byte count, and bit 31 marks the final frame. Each frame is sealed
with AES-256-GCM under a nonce of `noncePrefix || uint32LE(counter)`, and its AAD is the authenticated
header followed by that frame's length field, so a frame is bound to both its position and its size.
Reordering, resizing or splicing frames all fail.

Framing is canonical: every frame before the last carries exactly 1 MiB, there is exactly one final
frame, and it carries 0 bytes when the payload is empty or an exact multiple of 1 MiB. End of file
follows it immediately.

### Keys and authentication

```
key = scrypt(NFC(passphrase) as UTF-8, salt, 32 bytes, { N: 1 << log2N, r, p })
```

Normalising to NFC is part of the format, so a composed and a decomposed `é` do not derive different
keys on different machines. The salt is fresh per file, so the key is too, so a nonce can never repeat
under one key.

The **authenticated header** is the header up to the verifier tag, and both the verifier tag and every
frame use it as AAD. It deliberately stops before the verifier tag and the payload digest, since both
are written after the fact. That is also what lets a container whose verifier tag alone was damaged
still be read with `skipVerifier`.

The **verifier tag** is a GCM tag over an empty plaintext on the reserved counter `0xFFFFFFFF`, which
is what makes a wrong passphrase an instant answer instead of a full pass over the file.

The **payload digest** is a corruption check, not an authenticity check: it is written after the
payload, so it cannot be covered by the header's own authentication. Tampering is caught by GCM; the
digest catches bit rot, truncated copies and mangled transfers, and it works in every mode without the
passphrase.

### Limits

Frame counters run to `0xFFFFFFFE`, so the largest representable payload is just under 4 PiB. Readers
reject scrypt parameters outside `10 <= log2(N) <= 20`, `1 <= r <= 16`, `1 <= p <= 8`, and refuse any
cost above a configured memory ceiling before attempting the derivation.
