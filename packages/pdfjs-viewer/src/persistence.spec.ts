// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import interceptPersistence from "./persistence";
import { allFeaturesPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";
import { resolveViewerBundle } from "./test/viewer_bundle";

const SIGNATURE_KEY = "pdfjs.signature";
const ENTRY = { description: "Mine", signatureData: "data-1" };

/**
 * Captured before {@link interceptPersistence} monkey-patches `Storage.prototype`, so tests can
 * both restore the pristine methods afterwards and peek at the *real* backing store to prove that
 * intercepted keys never leak into it.
 */
let realGetItem: Storage["getItem"];
let realSetItem: Storage["setItem"];
let postMessageSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    localStorage.clear();
    realGetItem = Storage.prototype.getItem;
    realSetItem = Storage.prototype.setItem;

    window.TRILIUM_NOTE_ID = "note-1";
    window.TRILIUM_NTX_ID = "ntx-1";
    delete window.TRILIUM_SIGNATURES;
    delete window.TRILIUM_VIEW_HISTORY_STORE;

    // happy-dom has no real parent frame (window.parent === window); spy so we can assert the
    // payload synchronously instead of racing the async message event.
    postMessageSpy = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
    Storage.prototype.getItem = realGetItem;
    Storage.prototype.setItem = realSetItem;
    vi.restoreAllMocks();
    localStorage.clear();
});

/** Reads the real backing store, bypassing the interception patch installed on the prototype. */
function readRealStore(key: string) {
    return realGetItem.call(localStorage, key);
}

/**
 * Reads through the currently installed interception, as pdf.js does.
 *
 * happy-dom's `localStorage` is a proxy that resolves `getItem` once and then caches it, so
 * after the first test in this file touches it, `localStorage.getItem` stays pinned to
 * whichever patch was installed at that moment and never sees a later one. In a real browser
 * there is no proxy and `localStorage.getItem` *is* `Storage.prototype.getItem`, so going
 * through the prototype here is equivalent to what the viewer actually does — and, unlike the
 * bare instance call, it reads the patch the test under way installed.
 */
function readThroughPatch(key: string) {
    return Storage.prototype.getItem.call(localStorage, key);
}

describe("signature-library interception", () => {
    it("serves the injected library and never touches real localStorage on read", () => {
        interceptPersistence();

        // Nothing injected yet -> pdf.js sees an empty library, not `null`.
        expect(localStorage.getItem(SIGNATURE_KEY)).toBe("{}");

        window.TRILIUM_SIGNATURES = { abc: ENTRY };
        expect(JSON.parse(localStorage.getItem(SIGNATURE_KEY) ?? "null")).toEqual({ abc: ENTRY });

        // The library lives only in the injected global; the real store is never populated.
        expect(readRealStore(SIGNATURE_KEY)).toBeNull();
    });

    it("forwards writes to the parent, mirrors the global, and keeps them local-free", () => {
        interceptPersistence();

        const payload = JSON.stringify({ abc: ENTRY });
        localStorage.setItem(SIGNATURE_KEY, payload);

        expect(postMessageSpy).toHaveBeenCalledWith(
            {
                type: "pdfjs-viewer-save-signatures",
                data: payload,
                ntxId: "ntx-1",
                noteId: "note-1"
            },
            window.location.origin
        );
        // The in-session global is updated so a subsequent read stays consistent...
        expect(window.TRILIUM_SIGNATURES).toEqual({ abc: ENTRY });
        // ...but nothing is persisted to the browser's own localStorage.
        expect(readRealStore(SIGNATURE_KEY)).toBeNull();
    });

    it("aborts on a malformed payload instead of forwarding broken JSON", () => {
        window.TRILIUM_SIGNATURES = { abc: ENTRY };
        interceptPersistence();

        // A non-JSON value must not be forwarded — persisting it would make the parent's getJson
        // fall back to {} and wipe every saved signature. The prior library stays untouched.
        localStorage.setItem(SIGNATURE_KEY, "not json{");

        expect(postMessageSpy).not.toHaveBeenCalled();
        expect(window.TRILIUM_SIGNATURES).toEqual({ abc: ENTRY });
    });

    it("leaves unrelated keys and the view-history channel working", () => {
        interceptPersistence();

        // Unrelated keys pass straight through to the real store.
        localStorage.setItem("some-other-key", "value");
        expect(readRealStore("some-other-key")).toBe("value");

        // The pre-existing view-history interception is unaffected by the signature handling.
        window.TRILIUM_VIEW_HISTORY_STORE = { files: [] };
        expect(JSON.parse(localStorage.getItem("pdfjs.history") ?? "null")).toEqual({ files: [] });
        expect(readRealStore("pdfjs.history")).toBeNull();
    });
});

describe("real pdf.js SignatureStorage against the interception", () => {
    const { SignatureStorage } = loadRealSignatureStorage();
    const NEW_ENTRY = { description: "New one", signatureData: "sig-new" };

    function newStorage() {
        // signal=null skips the cross-tab `storage` listener; a minimal eventBus is enough.
        return new SignatureStorage({ dispatch: vi.fn() }, null);
    }

    it("uses the exact localStorage key our interception assumes", () => {
        // Guards the key name persistence.ts hard-codes; a pdf.js rename fails here.
        expect(SignatureStorage.EXPECTED_KEY).toBe(SIGNATURE_KEY);
    });

    it("reads the injected library through the patched storage", async () => {
        window.TRILIUM_SIGNATURES = { seed: { description: "Seed", signatureData: "sig-seed" } };
        interceptPersistence();

        const signatures = await newStorage().getAll();
        expect(signatures.get("seed")).toEqual({ description: "Seed", signatureData: "sig-seed" });
        expect(signatures.size).toBe(1);
    });

    it("routes a created signature to the parent without persisting locally", async () => {
        window.TRILIUM_SIGNATURES = {};
        interceptPersistence();

        const storage = newStorage();
        const uuid = await storage.create(NEW_ENTRY);
        expect(uuid).toBeTruthy();

        // pdf.js serialized and "saved" the new entry -> our interception caught and forwarded it.
        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const [ message ] = postMessageSpy.mock.calls[0];
        expect(message).toMatchObject({
            type: "pdfjs-viewer-save-signatures",
            noteId: "note-1",
            ntxId: "ntx-1"
        });
        expect(JSON.parse((message as { data: string }).data)).toEqual({ [uuid]: NEW_ENTRY });

        // The library reflects the addition in-session, but the browser store stays empty.
        expect(window.TRILIUM_SIGNATURES?.[uuid]).toEqual(NEW_ENTRY);
        expect(readRealStore(SIGNATURE_KEY)).toBeNull();

        // A fresh storage (fresh cache) still sees it, proving the read path round-trips.
        expect((await newStorage().getAll()).get(uuid)).toEqual(NEW_ENTRY);
    });
});

describe("preferences and pass-through reads", () => {
    it("serves the injected viewer options and leaves other keys to the real store", () => {
        interceptPersistence({ disablePreferences: true, sidebarViewOnLoad: 0 });

        // pdf.js reads its preferences out of localStorage on boot; this is how the options
        // Trilium passes through the iframe URL reach it.
        expect(JSON.parse(readThroughPatch("pdfjs.preferences") ?? "null"))
            .toEqual({ disablePreferences: true, sidebarViewOnLoad: 0 });

        realSetItem.call(localStorage, "unrelated", "kept");
        expect(readThroughPatch("unrelated")).toBe("kept");
        expect(readThroughPatch("never-written")).toBeNull();
    });
});

describe("view-history persistence", () => {
    let viewer: InstalledViewer;

    afterEach(() => {
        vi.useRealTimers();
        uninstallViewerApp();
    });

    it("debounces bursts of writes and keeps only the current document's entry", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // A real fingerprint from the real document — pdf.js derives it from the file's
        // contents, so hard-coding one here would drift the moment the fixture changed.
        const fingerprint = viewer.pdfDocument.fingerprints?.[0];
        expect(fingerprint).toBeTruthy();
        vi.useFakeTimers();
        interceptPersistence();

        const history = { files: [ { fingerprint, page: 3 }, { fingerprint: "some-other-document" } ] };
        localStorage.setItem("pdfjs.history", JSON.stringify({ files: [] }));
        localStorage.setItem("pdfjs.history", JSON.stringify(history));

        // pdf.js writes on every scroll, so nothing may be sent until the burst settles.
        expect(viewer.messagesOfType("pdfjs-viewer-save-view-history")).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(2_000);

        const sent = viewer.messagesOfType("pdfjs-viewer-save-view-history");
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ noteId: "note-1", ntxId: "ntx-1" });
        // Entries for other documents would otherwise accumulate in this note's option
        // forever, since each note stores the whole history blob.
        expect(JSON.parse(sent[0].data).files).toEqual([ { fingerprint, page: 3 } ]);

        // And the real store never sees the key.
        expect(readRealStore("pdfjs.history")).toBeNull();
    });

    it("keeps every entry when no document is loaded to filter against", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        delete window.PDFViewerApplication;
        vi.useFakeTimers();
        interceptPersistence();

        localStorage.setItem("pdfjs.history", JSON.stringify({ files: [ { fingerprint: "a" } ] }));
        await vi.advanceTimersByTimeAsync(2_000);

        const [ sent ] = viewer.messagesOfType("pdfjs-viewer-save-view-history");
        expect(JSON.parse(sent.data).files).toEqual([ { fingerprint: "a" } ]);
    });
});

/**
 * Extracts the real `SignatureStorage` class from the vendored pdf.js viewer bundle and evaluates
 * it with its two module-private dependencies injected. pdf.js does not export this class (it lives
 * inside the self-executing `viewer.mjs` app bundle), so this is the only way to drive pdf.js' own
 * storage code — rather than a re-implementation — against our interception. If pdf.js refactors
 * the class beyond recognition the extraction throws, the correct signal to revisit the wiring.
 */
function loadRealSignatureStorage(): { SignatureStorage: any } {
    // happy-dom rewrites `import.meta.url` to an http:// origin, so resolve the bundle from the
    // working directory instead — walking up to tolerate package-dir and monorepo-root runs.
    const bundle = readFileSync(resolveViewerBundle(), "utf8");

    const keyMatch = bundle.match(/KEY_STORAGE\s*=\s*"([^"]+)"/);
    if (!keyMatch) {
        throw new Error("Could not locate KEY_STORAGE in the vendored pdf.js viewer bundle");
    }
    const key = keyMatch[1];

    const start = bundle.indexOf("class SignatureStorage");
    if (start < 0) {
        throw new Error("Could not locate SignatureStorage in the vendored pdf.js viewer bundle");
    }
    const classSource = bundle.slice(start, matchingBraceEnd(bundle, start));

    let counter = 0;
    const getUuid = () => `uuid-${++counter}`;

    const body = `${classSource}\nreturn SignatureStorage;`;
    const factory = new Function("KEY_STORAGE", "getUuid", body);
    const SignatureStorage = factory(key, getUuid);
    // Expose the key pdf.js actually uses so the contract test can assert on it.
    SignatureStorage.EXPECTED_KEY = key;
    return { SignatureStorage };
}

/** Returns the index just past the `}` that closes the first `{` at or after `from`. */
function matchingBraceEnd(source: string, from: number): number {
    let depth = 0;
    let seenBrace = false;
    for (let i = from; i < source.length; i++) {
        const char = source[i];
        if (char === "{") {
            depth++;
            seenBrace = true;
        } else if (char === "}") {
            depth--;
            if (seenBrace && depth === 0) {
                return i + 1;
            }
        }
    }
    throw new Error("Unbalanced braces while extracting class from the pdf.js viewer bundle");
}
