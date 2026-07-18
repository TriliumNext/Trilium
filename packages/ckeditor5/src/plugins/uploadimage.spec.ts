import { ClassicEditor, Essentials, FileRepository, Paragraph, type FileLoader, type UploadAdapter } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import UploadimagePlugin from "./uploadimage.js";

/**
 * A fake XMLHttpRequest that records the calls the adapter makes and lets the
 * test drive the load / error / abort / progress lifecycle by hand.
 */
class FakeXHR {
    static last: FakeXHR | undefined;

    public method?: string;
    public url?: string;
    public async?: boolean;
    public responseType = "";
    public response: unknown = undefined;
    public sentData: unknown = undefined;
    public requestHeaders: Record<string, string> = {};

    public readonly upload = new EventTarget();
    private readonly listeners = new EventTarget();

    constructor() {
        FakeXHR.last = this;
    }

    open(method: string, url: string, async: boolean) {
        this.method = method;
        this.url = url;
        this.async = async;
    }

    setRequestHeader(name: string, value: string) {
        this.requestHeaders[name] = value;
    }

    addEventListener(type: string, listener: EventListener) {
        this.listeners.addEventListener(type, listener);
    }

    send(data: unknown) {
        this.sentData = data;
    }

    abort() {
        this.listeners.dispatchEvent(new Event("abort"));
    }

    fireLoad() {
        this.listeners.dispatchEvent(new Event("load"));
    }

    fireError() {
        this.listeners.dispatchEvent(new Event("error"));
    }

    fireUploadProgress(init: { lengthComputable: boolean; loaded: number; total: number }) {
        const evt = new ProgressEvent("progress", init);
        this.upload.dispatchEvent(evt);
    }
}

/**
 * A minimal FileLoader stand-in: only the members the adapter touches.
 */
function createFakeLoader(file: File | null): FileLoader {
    return {
        file: Promise.resolve(file),
        uploadTotal: 0,
        uploaded: 0
    } as unknown as FileLoader;
}

describe("UploadimagePlugin", () => {
    let editor: ClassicEditor;
    let getHeaders: ReturnType<typeof vi.fn>;
    let originalXHR: typeof window.XMLHttpRequest;

    beforeEach(async () => {
        getHeaders = vi.fn(async () => ({ Authorization: "Bearer token", "x-csrf": "abc" }));
        installGlobMock({
            getHeaders,
            getActiveContextNote: () => ({ noteId: "noteAbc" })
        });

        originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = FakeXHR as unknown as typeof window.XMLHttpRequest;
        FakeXHR.last = undefined;

        editor = await createTestEditor([Essentials, Paragraph, FileRepository, UploadimagePlugin]);
    });

    afterEach(() => {
        window.XMLHttpRequest = originalXHR;
    });

    function createAdapter(file: File | null): UploadAdapter {
        const fileRepository = editor.plugins.get(FileRepository);
        return fileRepository.createUploadAdapter(createFakeLoader(file));
    }

    it("loads the plugin and registers the upload adapter factory", () => {
        expect(editor.plugins.get(UploadimagePlugin)).toBeInstanceOf(UploadimagePlugin);
        expect(UploadimagePlugin.pluginName).toBe("UploadimagePlugin");
        expect(UploadimagePlugin.requires).toContain(FileRepository);

        const fileRepository = editor.plugins.get(FileRepository);
        expect(typeof fileRepository.createUploadAdapter).toBe("function");
    });

    it("resolves with the uploaded URL on a successful upload", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();

        // Wait for the request to be initialised and listeners attached.
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        // Assert the request was set up correctly.
        expect(xhr.method).toBe("POST");
        expect(xhr.url).toBe("api/notes/noteAbc/attachments/upload");
        expect(xhr.async).toBe(true);
        expect(xhr.responseType).toBe("json");
        expect(getHeaders).toHaveBeenCalledOnce();
        expect(xhr.requestHeaders).toEqual({ Authorization: "Bearer token", "x-csrf": "abc" });

        // The form data carries the file under the "upload" field.
        const sent = xhr.sentData;
        if (!(sent instanceof FormData)) {
            throw new Error("Expected FormData to be sent.");
        }
        expect(sent.get("upload")).toBe(file);

        xhr.response = { uploaded: true, url: "http://example.com/pic.png" };
        xhr.fireLoad();

        await expect(uploadPromise).resolves.toEqual({ default: "http://example.com/pic.png" });
    });

    it("rejects with the server error message when the response carries one", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        xhr.response = { uploaded: false, error: { message: "Disk full" } };
        xhr.fireLoad();

        await expect(uploadPromise).rejects.toBe("Disk full");
    });

    it("rejects with a generic message when the response has no usable error", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        // Falsy response (uploaded missing) and no error object → generic message.
        xhr.response = { uploaded: false };
        xhr.fireLoad();

        await expect(uploadPromise).rejects.toBe("Cannot upload file: pic.png.");
    });

    it("rejects with the generic message when there is no response at all", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        xhr.response = undefined;
        xhr.fireLoad();

        await expect(uploadPromise).rejects.toBe("Cannot upload file: pic.png.");
    });

    it("rejects with the generic message on a network error", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        xhr.fireError();

        await expect(uploadPromise).rejects.toBe("Cannot upload file: pic.png.");
    });

    it("rejects with no reason when the request is aborted", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const adapter = createAdapter(file);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        // abort() on the adapter forwards to the live xhr, which dispatches "abort".
        adapter.abort();

        await expect(uploadPromise).rejects.toBeUndefined();
    });

    it("does nothing when abort is called before a request was initialised", () => {
        const adapter = createAdapter(new File(["x"], "x.png", { type: "image/png" }));
        // No upload() yet → no xhr → abort must be a safe no-op.
        expect(() => adapter.abort()).not.toThrow();
    });

    it("updates the loader progress on computable progress events and ignores others", async () => {
        const file = new File(["content"], "pic.png", { type: "image/png" });
        const loader = createFakeLoader(file);
        const fileRepository = editor.plugins.get(FileRepository);
        const adapter = fileRepository.createUploadAdapter(loader);

        const uploadPromise = adapter.upload();
        await vi.waitFor(() => expect(FakeXHR.last).toBeDefined());
        const xhr = FakeXHR.last;
        if (!xhr) {
            throw new Error("XHR was never created.");
        }
        await vi.waitFor(() => expect(xhr.sentData).toBeInstanceOf(FormData));

        // Non-computable progress: the loader must remain untouched.
        xhr.fireUploadProgress({ lengthComputable: false, loaded: 5, total: 50 });
        expect(loader.uploadTotal).toBe(0);
        expect(loader.uploaded).toBe(0);

        // Computable progress: the loader fields get updated.
        xhr.fireUploadProgress({ lengthComputable: true, loaded: 20, total: 100 });
        expect(loader.uploadTotal).toBe(100);
        expect(loader.uploaded).toBe(20);

        // Finish the upload so the promise settles.
        xhr.response = { uploaded: true, url: "http://example.com/pic.png" };
        xhr.fireLoad();
        await expect(uploadPromise).resolves.toEqual({ default: "http://example.com/pic.png" });
    });

    it("rejects when the loader has no file", async () => {
        const adapter = createAdapter(null);

        // upload() resolves loader.file (null) before _initRequest; the promise body
        // still runs, _initListeners sees a null file and rejects with "Missing file".
        await expect(adapter.upload()).rejects.toBe("Missing file");
    });
});
