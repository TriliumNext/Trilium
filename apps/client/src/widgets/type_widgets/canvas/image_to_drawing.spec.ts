import { CANVAS_ATTACHMENT_MIME, CANVAS_ATTACHMENT_TITLE } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import server from "../../../services/server";
import toast from "../../../services/toast";
import { convertImageToDrawing } from "./image_to_drawing";

vi.mock("../../../services/server", () => ({ default: { upload: vi.fn(), remove: vi.fn() } }));
vi.mock("../../../services/toast", () => ({ default: { showError: vi.fn() } }));
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("@excalidraw/excalidraw", () => ({
    convertToExcalidrawElements: (skeletons: object[]) =>
        skeletons.map((skeleton) => ({ id: "e1", ...skeleton }))
}));
const saveDrawingPicture = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./persistence", () => ({ saveDrawingPicture }));

const upload = vi.mocked(server.upload);
const remove = vi.mocked(server.remove);

describe("convertImageToDrawing", () => {
    let imageType: string;
    let naturalSize: { width: number; height: number };

    beforeEach(() => {
        imageType = "image/png";
        naturalSize = { width: 800, height: 600 };
        vi.mocked(toast.showError).mockClear();
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            blob: async () => new Blob([ "png" ], { type: imageType })
        })));
        vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
        vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
            .mockImplementation(() => naturalSize.width);
        vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get")
            .mockImplementation(() => naturalSize.height);
        let attachmentCount = 0;
        upload.mockImplementation(async () => ({
            uploaded: true,
            url: `#root/n1?viewMode=attachments&attachmentId=att${++attachmentCount}`
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        upload.mockReset();
        remove.mockReset();
        saveDrawingPicture.mockClear();
    });

    it("attaches the image and a drawing that shows it, locked and centered", async () => {
        expect(await convertImageToDrawing("n1", "api/attachments/i1/image/a.png", "c1"))
            .toBe("att2");

        expect(fetch).toHaveBeenCalledWith("api/attachments/i1/image/a.png");
        const requests = upload.mock.calls
            .map(([ url, , componentId, method ]) => [ url, componentId, method ]);
        expect(requests).toEqual([
            [ "notes/n1/attachments/upload?link=true", "c1", "POST" ],
            [ "notes/n1/attachments/upload?link=true", "c1", "POST" ]
        ]);
        const [ [ , image ], [ , drawing ] ] = upload.mock.calls;
        expect(image.name).toMatch(/^[A-Za-z0-9]{20}\.png$/);
        expect(image.type).toBe("image/png");
        expect(drawing.name).toBe(CANVAS_ATTACHMENT_TITLE);
        expect(drawing.type).toBe(CANVAS_ATTACHMENT_MIME);

        const content = JSON.parse(await drawing.text());
        expect(content).toEqual({
            type: "excalidraw",
            version: 2,
            elements: [ {
                id: "e1",
                type: "image",
                fileId: image.name,
                status: "saved",
                x: -400,
                y: -300,
                width: 800,
                height: 600,
                locked: true
            } ],
            files: {},
            appState: {}
        });
        expect(toast.showError).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(saveDrawingPicture).toHaveBeenCalledOnce());
        expect(saveDrawingPicture).toHaveBeenCalledWith(
            { attachmentId: "att2", ownerId: "n1" },
            await drawing.text(),
            { [image.name]: {
                id: image.name,
                mimeType: "image/png",
                dataURL: "data:image/png;base64,cG5n",
                created: expect.any(Number)
            } }
        );
    });

    it("keeps the drawing when its picture cannot be saved", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        saveDrawingPicture.mockRejectedValueOnce(new Error("Offline."));

        expect(await convertImageToDrawing("n1", "api/attachments/i1/image/a.png")).toBe("att2");
        await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it("tells that it failed, and attaches nothing, for what is no picture", async () => {
        imageType = "text/html";
        expect(await convertImageToDrawing("n1", "https://example.com/a.png")).toBeNull();

        imageType = "image/png";
        naturalSize = { width: 0, height: 0 };
        expect(await convertImageToDrawing("n1", "api/attachments/i1/image/a.png")).toBeNull();

        expect(upload).not.toHaveBeenCalled();
        expect(toast.showError).toHaveBeenCalledTimes(2);
        expect(toast.showError).toHaveBeenCalledWith("image.cannot-convert-to-drawing");
    });

    it("tells that it failed when the server refuses an upload", async () => {
        upload.mockResolvedValueOnce({ uploaded: false, message: "No." });
        expect(await convertImageToDrawing("n1", "api/attachments/i1/image/a.png")).toBeNull();
        expect(upload).toHaveBeenCalledOnce();
        expect(remove).not.toHaveBeenCalled();
        expect(toast.showError).toHaveBeenCalledOnce();
    });

    it("removes the copy of the image when the drawing cannot be attached", async () => {
        upload.mockResolvedValueOnce({ uploaded: true, url: "#root/n1?attachmentId=img1" })
            .mockResolvedValueOnce({ uploaded: false, message: "No." });
        remove.mockRejectedValueOnce(new Error("Offline."));

        expect(await convertImageToDrawing("n1", "api/attachments/i1/image/a.png", "c1"))
            .toBeNull();
        expect(remove).toHaveBeenCalledExactlyOnceWith("attachments/img1", "c1");
        expect(toast.showError).toHaveBeenCalledOnce();
    });
});
