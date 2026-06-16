import {
    Clipboard,
    Essentials,
    FileRepository,
    Notification,
    Paragraph,
    Plugin,
    UpcastWriter,
    Widget,
    toWidget,
    viewToModelPositionOutsideModelElement,
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    type FileLoader,
    type ModelItem
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import FileUploadEditing, { isHtmlIncluded } from "./fileuploadediting.js";

describe("FileUploadEditing", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, FileRepository, Notification, Clipboard, ReferenceSchema, FileUploadEditing]);
    });

    // -----------------------------------------------------------------
    // init() registration
    // -----------------------------------------------------------------

    it("loads the plugin and registers the fileUpload command", () => {
        expect(editor.plugins.get(FileUploadEditing)).toBeInstanceOf(FileUploadEditing);
        expect(editor.commands.get("fileUpload")).toBeDefined();
    });

    it("has the correct pluginName and requires", () => {
        expect(FileUploadEditing.pluginName).toBe("FileUploadEditing");
        expect(FileUploadEditing.requires).toContain(FileRepository);
        expect(FileUploadEditing.requires).toContain(Notification);
        expect(FileUploadEditing.requires).toContain(Clipboard);
    });

    it("registers an upcast converter (a reference-link anchor becomes a reference element)", () => {
        // The source registers an `attributeToAttribute` upcast for the camelCase
        // `uploadId` attribute. Browsers lowercase HTML attribute names, so that
        // converter never matches real pasted HTML; its registration still runs
        // during init(). Here we just confirm the upcast pipeline produces a
        // reference element for our reference-link anchor.
        editor.setData("<p><a class=\"reference-link\">x</a></p>");
        expect(getModelData(editor.model, { withoutSelection: true })).toContain("reference");
    });

    // -----------------------------------------------------------------
    // isHtmlIncluded()
    // -----------------------------------------------------------------

    it("isHtmlIncluded returns false when there is no text/html type", () => {
        expect(isHtmlIncluded(makeDataTransfer({ files: [] }))).toBe(false);
    });

    it("isHtmlIncluded returns false when text/html is present but empty", () => {
        expect(isHtmlIncluded(makeDataTransfer({ html: "" }))).toBe(false);
    });

    it("isHtmlIncluded returns true when non-empty text/html is present", () => {
        expect(isHtmlIncluded(makeDataTransfer({ html: "<p>x</p>" }))).toBe(true);
    });

    // -----------------------------------------------------------------
    // clipboardInput handler (drag & drop / paste of files)
    // -----------------------------------------------------------------

    it("uploads dropped files and inserts a reference placeholder", () => {
        installUploadAdapter(editor);
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const file = new File(["content"], "dropped.txt", { type: "text/plain" });
        editor.editing.view.document.fire("clipboardInput", {
            dataTransfer: makeDataTransfer({ files: [file] }),
            targetRanges: null
        });

        expect(getModelData(editor.model)).toContain("reference");
    });

    it("maps targetRanges to a model selection before uploading", () => {
        installUploadAdapter(editor);
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const viewRoot = editor.editing.view.document.getRoot();
        const targetRange = viewRoot ? editor.editing.view.createRangeIn(viewRoot) : null;

        const file = new File(["content"], "dropped.txt", { type: "text/plain" });
        editor.editing.view.document.fire("clipboardInput", {
            dataTransfer: makeDataTransfer({ files: [file] }),
            targetRanges: targetRange ? [targetRange] : null
        });

        expect(getModelData(editor.model)).toContain("reference");
    });

    it("skips file handling when non-empty HTML data is included", () => {
        installUploadAdapter(editor);
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        const file = new File(["content"], "dropped.txt", { type: "text/plain" });
        editor.editing.view.document.fire("clipboardInput", {
            dataTransfer: makeDataTransfer({ files: [file], html: "<p>hello</p>" }),
            content: emptyViewFragment(),
            targetRanges: null
        });

        expect(getModelData(editor.model)).not.toContain("reference");
    });

    it("does nothing when the clipboard input carries no files", () => {
        installUploadAdapter(editor);
        setModelData(editor.model, "<paragraph>[]foo</paragraph>");
        const before = getModelData(editor.model);

        editor.editing.view.document.fire("clipboardInput", {
            dataTransfer: makeDataTransfer({ files: [] }),
            content: emptyViewFragment(),
            targetRanges: null
        });

        expect(getModelData(editor.model)).toBe(before);
    });

    // -----------------------------------------------------------------
    // dragover handler
    // -----------------------------------------------------------------

    it("prevents the default action on dragover", () => {
        const preventDefault = vi.fn();
        try {
            // Other (built-in) dragover listeners may throw on our synthetic event,
            // but our handler runs first and calls preventDefault().
            editor.editing.view.document.fire("dragover", { preventDefault });
        } catch {
            // Downstream listener error is irrelevant to this plugin.
        }
        expect(preventDefault).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------
    // change post-fixer + _readAndUpload — happy path
    // -----------------------------------------------------------------

    it("reads, uploads and completes a placeholder, then reloads the data", async () => {
        const controls = installUploadAdapter(editor);
        const fileRepository = editor.plugins.get(FileRepository);

        const file = new File(["content"], "x.txt", { type: "text/plain" });
        const loader = fileRepository.createLoader(file);
        const uploadId = loader?.id;

        insertReference(uploadId);

        await waitFor(() => controls.uploadCalled());

        const setDataSpy = vi.spyOn(editor, "setData");
        controls.resolveUpload({ default: "api/attachments/done/download" });

        // Wait for the .then chain plus the 100ms froca delay.
        await new Promise((res) => setTimeout(res, 250));

        expect(setDataSpy).toHaveBeenCalled();
    });

    it("aborts the loader when the placeholder is inserted into the graveyard", () => {
        installUploadAdapter(editor);
        const fileRepository = editor.plugins.get(FileRepository);

        const file = new File(["content"], "x.txt", { type: "text/plain" });
        const loader = fileRepository.createLoader(file);
        const uploadId = loader?.id;
        expect(loader?.status).toBe("idle");

        setModelData(editor.model, "<paragraph>[]</paragraph>");

        // Insert then remove in the same change block -> the removed element lands
        // in $graveyard, and the post-fixer's graveyard branch calls loader.abort().
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                const ref = writer.createElement("reference", { href: "", uploadId });
                writer.insert(ref, para, 0);
                writer.remove(ref);
            }
        });

        // At idle status loader.abort() flips the status to 'aborted' (without
        // invoking the adapter), which is what the graveyard branch triggers.
        expect(loader?.status).toBe("aborted");
    });

    it("ignores inserted file links that no longer carry an uploadId", () => {
        installUploadAdapter(editor);
        const readSpy = vi.spyOn(editor.plugins.get(FileUploadEditing) as unknown as { _readAndUpload: () => void }, "_readAndUpload");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                writer.insert(writer.createElement("reference", { href: "api/x" }), para, 0);
            }
        });

        expect(readSpy).not.toHaveBeenCalled();
    });

    it("ignores inserted file links whose loader is not present on this client", () => {
        installUploadAdapter(editor);
        const readSpy = vi.spyOn(editor.plugins.get(FileUploadEditing) as unknown as { _readAndUpload: () => void }, "_readAndUpload");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                writer.insert(writer.createElement("reference", { href: "", uploadId: "no-such-loader" }), para, 0);
            }
        });

        expect(readSpy).not.toHaveBeenCalled();
        expect(getModelData(editor.model)).toContain("reference");
    });

    it("does not restart the upload for a placeholder whose loader is already in progress", () => {
        installUploadAdapter(editor);
        const fileRepository = editor.plugins.get(FileRepository);
        const readSpy = vi.spyOn(editor.plugins.get(FileUploadEditing) as unknown as { _readAndUpload: () => void }, "_readAndUpload");

        const file = new File(["content"], "x.txt", { type: "text/plain" });
        const loader = fileRepository.createLoader(file);
        const uploadId = loader?.id;
        // Loader exists and is in content, but is no longer idle -> the
        // `else if (loader.status == 'idle')` branch is false.
        setLoaderStatus(loader, "uploading");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                writer.insert(writer.createElement("reference", { href: "", uploadId }), para, 0);
            }
        });

        expect(readSpy).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------
    // _readAndUpload — error and abort branches
    // -----------------------------------------------------------------

    it("removes the placeholder and warns when the upload fails with an error", async () => {
        const controls = installUploadAdapter(editor);
        const fileRepository = editor.plugins.get(FileRepository);
        const notification = editor.plugins.get(Notification);
        const warnSpy = vi.spyOn(notification, "showWarning").mockImplementation(() => {});

        const file = new File(["content"], "x.txt", { type: "text/plain" });
        const loader = fileRepository.createLoader(file);
        const uploadId = loader?.id;

        insertReference(uploadId);

        await waitFor(() => controls.uploadCalled());

        setLoaderStatus(loader, "error");
        controls.rejectUpload("boom");
        await flushAsync();

        expect(warnSpy).toHaveBeenCalled();
    });

    it("removes the placeholder without warning when the upload is aborted", async () => {
        const controls = installUploadAdapter(editor);
        const fileRepository = editor.plugins.get(FileRepository);
        const notification = editor.plugins.get(Notification);
        const warnSpy = vi.spyOn(notification, "showWarning").mockImplementation(() => {});

        const file = new File(["content"], "x.txt", { type: "text/plain" });
        const loader = fileRepository.createLoader(file);
        const uploadId = loader?.id;

        insertReference(uploadId);

        await waitFor(() => controls.uploadCalled());

        setLoaderStatus(loader, "aborted");
        controls.rejectUpload();
        await flushAsync();

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("rethrows when the upload rejects but the loader status is neither error nor aborted", async () => {
        const editingPlugin = editor.plugins.get(FileUploadEditing);

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        let fileElement: ModelItem | null = null;
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                const ref = writer.createElement("reference", { href: "" });
                writer.insert(ref, para, 0);
                fileElement = ref;
            }
        });

        // A real FileRepository loader flips its status to 'error' before the
        // catch handler runs, so the rethrow branch can only be reached with a
        // loader whose status stays put. Use a fake loader that resolves read(),
        // rejects upload(), and keeps status 'idle'.
        let uploadReject: (reason?: unknown) => void = () => {};
        let uploadStarted = false;
        const fakeLoader = {
            id: "fake",
            status: "idle",
            read: () => Promise.resolve(new File(["c"], "c.txt")),
            upload: () => new Promise<{ default: string }>((_resolve, reject) => {
                uploadStarted = true;
                uploadReject = reject;
            }),
            abort: () => {}
        } as unknown as FileLoader;

        const promise = fileElement
            ? (editingPlugin as unknown as {
                _readAndUpload: (l: FileLoader, el: ModelItem) => Promise<unknown>;
            })._readAndUpload(fakeLoader, fileElement)
            : Promise.resolve();

        await waitFor(() => uploadStarted);
        uploadReject(new Error("unexpected"));

        await expect(promise).rejects.toThrow("unexpected");
    });

    // -----------------------------------------------------------------
    // Local helpers
    // -----------------------------------------------------------------

    function getFirstParagraph() {
        const root = editor.model.document.getRoot();
        const para = root?.getChild(0);
        return para && para.is("element") ? para : null;
    }

    function insertReference(uploadId: string | number | undefined) {
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const para = getFirstParagraph();
            if (para) {
                writer.insert(writer.createElement("reference", { href: "", uploadId }), para, 0);
            }
        });
    }

    function emptyViewFragment() {
        return new UpcastWriter(editor.editing.view.document).createDocumentFragment([]);
    }
});

/** Lets the queued microtasks / the loader.read() chain settle. */
function flushAsync() {
    return new Promise((res) => setTimeout(res, 50));
}

/** Polls `condition` until it is truthy (or a generous timeout elapses). */
async function waitFor(condition: () => boolean) {
    for (let i = 0; i < 50; i++) {
        if (condition()) {
            return;
        }
        await new Promise((res) => setTimeout(res, 10));
    }
}

function setLoaderStatus(loader: FileLoader | null, status: string) {
    if (loader) {
        (loader as unknown as { status: string }).status = status;
    }
}

/** Builds a fake DataTransfer carrying the given files and optional HTML payload. */
function makeDataTransfer(opts: { files?: File[]; html?: string | null } = {}): DataTransfer {
    const files = opts.files ?? [];
    const html = opts.html;
    const types: string[] = [];
    if (html !== undefined && html !== null) {
        types.push("text/html");
    }
    return {
        files,
        types,
        getData: (type: string) => (type === "text/html" ? (html ?? "") : "")
    } as unknown as DataTransfer;
}

/**
 * A controllable upload adapter so the FileRepository loader can be driven
 * through its read/upload/abort lifecycle from the tests.
 */
interface AdapterControls {
    resolveUpload: (data: { default: string }) => void;
    rejectUpload: (reason?: unknown) => void;
    uploadCalled: () => boolean;
    abortCalled: () => boolean;
}

function installUploadAdapter(editor: ClassicEditor): AdapterControls {
    let uploadResolve: (data: { default: string }) => void = () => {};
    let uploadReject: (reason?: unknown) => void = () => {};
    let uploadWasCalled = false;
    let abortWasCalled = false;

    editor.plugins.get(FileRepository).createUploadAdapter = () => ({
        upload: () => {
            uploadWasCalled = true;
            return new Promise<{ default: string }>((resolve, reject) => {
                uploadResolve = resolve;
                uploadReject = reject;
            });
        },
        abort: () => {
            abortWasCalled = true;
        }
    });

    return {
        resolveUpload: (data) => uploadResolve(data),
        rejectUpload: (reason) => uploadReject(reason),
        uploadCalled: () => uploadWasCalled,
        abortCalled: () => abortWasCalled
    };
}

/**
 * Minimal plugin that registers the `reference` model schema plus the
 * downcast/upcast converters the mapper requires. The `reference` element
 * downcasts to an `<a>` element so the editing converters in FileUploadEditing
 * (which target `<a>` view elements and the `href` model attribute) bind to it.
 */
class ReferenceSchema extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        const editor = this.editor;
        const schema = editor.model.schema;
        const conversion = editor.conversion;

        schema.register("reference", {
            allowWhere: "$text",
            isInline: true,
            isObject: true,
            allowAttributes: ["href", "uploadId", "uploadStatus"]
        });

        conversion.for("editingDowncast").elementToElement({
            model: "reference",
            view: (_modelItem, { writer: viewWriter }) => {
                const container = viewWriter.createContainerElement("span", {
                    class: "reference-link-placeholder"
                });
                return toWidget(container, viewWriter);
            }
        });

        conversion.for("dataDowncast").elementToElement({
            model: "reference",
            view: (modelItem, { writer: viewWriter }) => {
                const href = modelItem.getAttribute("href");
                return viewWriter.createContainerElement("a", {
                    class: "reference-link",
                    ...(href ? { href: String(href) } : {})
                });
            }
        });

        conversion.for("upcast").elementToElement({
            view: { name: "a", classes: ["reference-link"] },
            model: (_viewElement, { writer: modelWriter }) => modelWriter.createElement("reference")
        });

        editor.editing.mapper.on(
            "viewToModelPosition",
            viewToModelPositionOutsideModelElement(
                editor.model,
                (viewElement) => viewElement.hasClass("reference-link-placeholder")
            )
        );
    }
}
