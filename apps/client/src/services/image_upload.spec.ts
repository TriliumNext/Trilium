import { afterEach, describe, expect, it, vi } from "vitest";

import { dataUrlToImageFile, parseImageDataUrl, uploadImageAttachment } from "./image_upload";
import server from "./server";

vi.mock("./server", () => ({ default: { upload: vi.fn() } }));

const serverUpload = vi.mocked(server.upload);

describe("parseImageDataUrl", () => {
    it("splits a base64 data URL into its mime, raw base64 and extension", () => {
        expect(parseImageDataUrl("data:image/png;base64,AAAA")).toEqual({ mime: "image/png", base64: "AAAA", ext: "png" });
        expect(parseImageDataUrl("data:image/jpeg;base64,BBBB")?.ext).toBe("jpeg");
    });

    it("maps svg+xml to a clean 'svg' extension", () => {
        expect(parseImageDataUrl("data:image/svg+xml;base64,Q0M=")?.ext).toBe("svg");
    });

    it("returns null for non-base64 data URLs and plain URLs", () => {
        expect(parseImageDataUrl("api/attachments/x/image/x.png")).toBeNull();
        expect(parseImageDataUrl("data:image/png,notbase64")).toBeNull();
    });
});

describe("dataUrlToImageFile", () => {
    it("decodes the base64 payload into a File with the parsed mime and extension", async () => {
        const file = dataUrlToImageFile("data:image/png;base64,QUJD"); // "ABC"
        expect(file).not.toBeNull();
        expect(file?.type).toBe("image/png");
        expect(file?.name).toBe("image.png");
        expect(await file?.text()).toBe("ABC");
    });

    it("returns null when the input is not a base64 data URL", () => {
        expect(dataUrlToImageFile("https://example.com/a.png")).toBeNull();
    });

    it("returns null for a malformed base64 payload instead of throwing", () => {
        // atob throws a DOMException on invalid base64; the decode must be guarded.
        expect(dataUrlToImageFile("data:image/png;base64,@@@not-base64@@@")).toBeNull();
    });
});

describe("uploadImageAttachment", () => {
    afterEach(() => vi.clearAllMocks());

    it("uploads the decoded image and returns the attachment URL on success", async () => {
        serverUpload.mockResolvedValue({ uploaded: true, url: "api/attachments/new1/image/image.png" });

        const url = await uploadImageAttachment("note1", "data:image/png;base64,QUJD");

        expect(url).toBe("api/attachments/new1/image/image.png");
        expect(serverUpload).toHaveBeenCalledWith("notes/note1/attachments/upload", expect.any(File), undefined, "POST");
    });

    it("returns null when the server reports the upload did not succeed", async () => {
        serverUpload.mockResolvedValue({ uploaded: false });
        expect(await uploadImageAttachment("note1", "data:image/png;base64,QUJD")).toBeNull();
    });

    it("returns null without uploading when the data URL cannot be parsed", async () => {
        expect(await uploadImageAttachment("note1", "not-a-data-url")).toBeNull();
        expect(serverUpload).not.toHaveBeenCalled();
    });

    it("returns null when the upload throws", async () => {
        serverUpload.mockRejectedValue(new Error("network"));
        expect(await uploadImageAttachment("note1", "data:image/png;base64,QUJD")).toBeNull();
    });
});
