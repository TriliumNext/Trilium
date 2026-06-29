# Shell input validators (the untrusted-renderer boundary)

All five live in [`apps/desktop/src/services/shell.ts`](../../../../apps/desktop/src/services/shell.ts) and back the `window.electronApi.shell.*` channels. The renderer is XSS-reachable, so each validator **throws** on any invariant violation; the `setupShellHandlers()` IPC handlers catch the throw and log it (so a hostile or buggy caller surfaces loudly instead of triggering an OS action). Each is exported and unit-tested in `apps/desktop/src/services/shell.spec.ts`.

> The commons docstring at `electron_api_interface.ts:240` still points at `apps/server/src/services/shell_validators.ts` — that source file is **gone** (only `apps/server/out-tsc/.../shell_validators.d.ts` build artifacts remain). The live validators are the ones below.

## Shared helpers (`shell.ts:18-37`)

- `normalizeForCompare(p)` — lowercases on `win32` (case-insensitive FS), passthrough on POSIX.
- `isStrictlyUnder(resolved, root)` — `resolved` is a *strict descendant* of `root` (prefix is `resolve(root) + path.sep`).
- `isUnderOrEquals(resolved, root)` — equals `root` or is a descendant.

These do the sandbox math; UNC paths and `..` traversal can't normalize under the data/tmp roots, so the sandbox check rejects them implicitly.

## The five validators

| Validator (`shell.ts`) | Channel | Returns | Core check |
|---|---|---|---|
| `validateOpenExternalUrl(input)` `:106` | `open-external` (`send`) | `URL` | parses URL; lowercased scheme must be in `SHELL_OPEN_EXTERNAL_PROTOCOLS`; throws `blocked scheme '<x>'` otherwise |
| `validateOpenPath(input, dataDir, tmpDir)` `:78` | `open-path` (`invoke`) | resolved path | reject non-string / empty / `\0`; `path.resolve`; must be under-or-equal `dataDir` **or** `tmpDir`; must exist on disk |
| `validateOpenCustomPath(filePath, tmpDir)` `:47` | `open-custom` (`send`) | resolved path | same string checks; must be a **strict descendant** of `tmpDir` (not the dir itself); must exist |
| `validateOpenFileUrl(input)` `:138` | `open-file-url` (`invoke`) | resolved FS path | normalize `file://C:/`→`file:///C:/`; parse; protocol must be `file:`; **hostname must be empty** (UNC block); `url.fileURLToPath` |
| `validateDownloadUrl(input, allowedOrigin)` `:178` | `download-url` (`send`) | `URL` | parse both URLs; both hostnames non-empty; **scheme+hostname+port must all match** the allowed origin |

## Why each check exists (threat model)

### `validateOpenExternalUrl` — scheme allowlist
`electron.shell.openExternal` hands the URL to the **OS protocol handler**. Historically that is a Follina-class RCE primitive on Windows (`ms-msdt:`, `search-ms:`, `ms-officecmd:`) and a credential-leak primitive (`smb:`, `ldap:`). Allowlisting the scheme is the only reliable defence (`shell.ts:99-105`). The check (`shell.ts:118-122`):

```ts
const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
if (!SHELL_OPEN_EXTERNAL_PROTOCOLS.includes(scheme)) {
    throw new Error(`open-external: blocked scheme '${scheme}'`);
}
```

The same validator gates note-content links opened via `window.open` — `installWindowOpenPolicy` in `web_contents_security.ts:226` reuses `validateOpenExternalUrl` so a `target=_blank` link can't bypass the allowlist.

### `validateOpenPath` / `validateOpenCustomPath` — data/tmp sandbox + UNC block
Legit callers (Open Note/Attachment Externally, the About dialog's "open data directory", and the "Open With…" custom handler) only ever pass server-generated paths inside the tmp dir or equal to the data dir. UNC paths (`\\attacker\share\x`) can't normalize under those roots, so the sandbox check rejects them — closing the same NTLM-hash-leak vector that `file://` and `smb://` have (`shell.ts:74-77`). `open-custom` is stricter (strict descendant of tmp only) because its caller always passes a path freshly written by `saveToTmpDir`.

### `validateOpenFileUrl` — UNC hostname block
A `file:` URL with a **non-empty hostname** (`file://attacker.example/share/x`) resolves on Windows to `\\attacker.example\share\x`, which triggers SMB authentication and leaks the user's NTLM hash (`shell.ts:131-137`). The guard:

```ts
if (parsed.protocol !== "file:") throw new Error(...);
if (parsed.hostname !== "")     throw new Error(`open-file-url: UNC path blocked: ${parsed.hostname}`);
```

Unlike `open-path`, the resolved path is **not** confined to data/tmp — this channel handles user-clicked `file://` links in note content, which legitimately reference arbitrary disk locations. It exists as a separate channel from `open-external` because `shell.openExternal` mishandles Unicode in `file:` URLs on Windows.

### `validateDownloadUrl` — same-origin lock (can't use `URL.origin`)
`WebContents.downloadURL` writes straight to Downloads. Locking it to the renderer's own origin stops a compromised renderer from pre-positioning a malicious file under a familiar name. The subtlety (`shell.ts:197-211`): Electron serves the renderer from the custom `trilium-app://app/` scheme, which the WHATWG URL spec treats as **opaque-origin** (`.origin === "null"`) — two opaque origins string-compare equal even across different hosts. So the check requires both hostnames non-empty (rules out `data:`/`file:///`/`about:`/`blob:`) and compares **scheme + hostname + port** component-by-component instead of `.origin`. The `allowedOrigin` is `event.sender.getURL()` (`shell.ts:265`).

## Commons constants

[`packages/commons/src/lib/shared_constants.ts`](../../../../packages/commons/src/lib/shared_constants.ts):

- `SHELL_OPEN_EXTERNAL_PROTOCOLS` (`:40`) is **derived by filtering** `ALLOWED_PROTOCOLS` (the sanitizer/CKEditor display allowlist) through `SHELL_OPEN_EXTERNAL_BLOCKLIST = { file, data, smb, ldap, ldaps, jar, view-source }` (`:37`). Deriving rather than duplicating keeps DISPLAY and DISPATCH in sync when `ALLOWED_PROTOCOLS` gains entries. `ALLOWED_PROTOCOLS` gates what the sanitizer *renders*; `SHELL_OPEN_EXTERNAL_PROTOCOLS` gates what the main process will *dispatch* to the OS. Invariants are tested in `shared_constants.spec.ts` (blocklist excluded; `https`/`tel`/`ftp` included; subset of `ALLOWED_PROTOCOLS`).
- `WEBVIEW_SESSION_PARTITION = "persist:webview"` (`:52`) — the dedicated `<webview>` guest partition. Shared between the client (`<webview partition=…>`) and the main process (`session.fromPartition()` permission handlers + the `hardenWebviewPreferences` partition check). See the protocol-and-security-triage reference.

## Testing validators

These are **pure functions** — test them directly, no IPC harness, per the writing-unit-tests "extract pure logic" principle:

```ts
import { describe, expect, it } from "vitest";
import { validateOpenExternalUrl, validateDownloadUrl } from "./shell.js";

describe("validateOpenExternalUrl", () => {
    it("rejects Follina / NTLM-leak schemes, allows https", () => {
        expect(() => validateOpenExternalUrl("ms-msdt:/id")).toThrow(/blocked scheme/);
        expect(() => validateOpenExternalUrl("smb://host/share")).toThrow(/blocked scheme/);
        expect(validateOpenExternalUrl("https://example.com").protocol).toBe("https:");
    });
});

describe("validateDownloadUrl", () => {
    it("blocks cross-origin, allows same scheme+host+port", () => {
        const origin = "trilium-app://app/";
        expect(() => validateDownloadUrl("https://evil.test/x", origin)).toThrow(/cross-origin/);
        expect(validateDownloadUrl("trilium-app://app/download/x", origin).hostname).toBe("app");
    });
});
```

Path validators take injected `dataDir`/`tmpDir` args precisely so a test can point them at a `fs.mkdtemp` dir and assert the sandbox boundary without touching the real data dir.
