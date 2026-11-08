import type { ResourceDownloadProgress, ResourcesStatusResponse, WebSocketMessage } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ResourceDownloadDialog from "./resource_download";

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    get: vi.fn(async (): Promise<unknown> => []),
    handlers: new Set<(message: WebSocketMessage) => void>()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: object) => (values ? `${key}:${JSON.stringify(values)}` : key)
}));
// The real i18n is not initialized under test, so `Trans` would render the bare key and drop what
// it wires in; the stub renders its values and the components themselves.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, values, components }: {
        i18nKey: string, values: object, components: Record<string, preact.VNode>
    }) => (
        <span data-i18n-key={i18nKey}>{JSON.stringify(values)}{Object.values(components)}</span>
    )
}));
vi.mock("../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post }
}));
vi.mock("../../services/ws", () => {
    const ws = {
        subscribeToMessages: (handler: (message: WebSocketMessage) => void) => mocks.handlers.add(handler),
        unsubscribeToMessage: (handler: (message: WebSocketMessage) => void) => mocks.handlers.delete(handler)
    };
    return { default: ws, ...ws };
});

const STATUS: ResourcesStatusResponse = {
    resources: [ {
        id: "transcription.model",
        title: "Speech recognition model",
        description: "Transcribes meetings",
        icon: "bx bx-captions",
        license: "CC-BY-4.0",
        size: 700,
        downloadedSize: 200,
        unverifiedSize: 0,
        sources: [ "huggingface.co", "github.com" ],
        author: "NVIDIA",
        homepage: "https://example.com/model",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        installed: false,
        directory: null
    } ],
    freeBytes: 10_000,
    download: null
};

describe("ResourceDownloadDialog", () => {
    let host: Component;
    let container: HTMLElement;
    let results: boolean[];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockResolvedValue(installed(STATUS));
        mocks.handlers.clear();
        results = [];
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <ResourceDownloadDialog />
            </ParentComponent.Provider>
        );
    });

    it("describes what it downloads, and resolves once the download succeeds", async () => {
        mocks.post.mockResolvedValue(progress({ receivedBytes: 200 }));
        await open();

        const row = container.querySelector(".resource-download-item");
        expect(row?.querySelector(".resource-download-icon")?.classList).toContain("bx-captions");
        expect(row?.textContent).toContain("Speech recognition model");
        const credits = container.querySelector(".resource-download-meta");
        expect(credits?.querySelector("[data-i18n-key]")?.textContent)
            .toBe(`{"author":"NVIDIA","sources":"huggingface.co, github.com"}`);
        expect(credits?.querySelector(".resource-download-author")?.getAttribute("href"))
            .toBe("https://example.com/model");
        const license = credits?.querySelector(".resource-download-license");
        expect(license?.textContent).toBe(`resource_download.license:{"license":"CC-BY-4.0"}`);
        expect(license?.getAttribute("href")).toBe("https://creativecommons.org/licenses/by/4.0/");
        expect(row?.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("200");
        expect(row?.querySelector(".resource-download-progress")?.textContent)
            .toContain(`"received":"200 B","total":"700 B"`);
        expect(text(".resource-download-item .resource-download-size")).toBe("500 B");
        expect(text(".resource-download-total .resource-download-size")).toBe("500 B");
        expect(text(".resource-download-total")).toContain(`free_space:{"size":"9.77 KiB"}`);
        expect(container.querySelector(".admonition")).toBeNull();

        await click("resource_download.download");
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith("resources/download",
            { ids: [ "transcription.model" ] });
        expect(row?.querySelector(".resource-download-icon")?.classList).toContain("bx-loader-circle");
        expect(row?.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("200");

        await send(progress({ receivedBytes: 600, file: "encoder.int8.onnx" }));
        expect(row?.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("600");
        expect(row?.querySelector(".resource-download-progress")?.textContent)
            .toContain("encoder.int8.onnx");

        await send(progress({ status: "succeeded", receivedBytes: 700 }));
        await hidden();
        expect(results).toEqual([ true ]);
    });

    it("downloads the rest when the download it joined ends without every resource it needs", async () => {
        const vad = { ...STATUS.resources[0], id: "transcription.vad", title: "VAD", downloadedSize: 0 };
        const status = { ...STATUS, resources: [ ...STATUS.resources, vad ] };
        const ids = [ "transcription.model", "transcription.vad" ];
        mocks.post.mockResolvedValue(progress({ downloadId: "joined" }));
        await open(status, ids);
        await click("resource_download.download");

        mocks.get.mockResolvedValue({ ...status, resources: [ installed(STATUS).resources[0], vad ] });
        mocks.post.mockResolvedValue(progress({ downloadId: "rest", resourceIds: ids }));
        await send(progress({ downloadId: "joined", status: "succeeded" }));
        expect(mocks.get).toHaveBeenLastCalledWith("resources?ids=transcription.model,transcription.vad");
        expect(mocks.post).toHaveBeenLastCalledWith("resources/download", { ids });

        mocks.get.mockResolvedValue(installed(status));
        await send(progress({ downloadId: "rest", resourceIds: ids, status: "succeeded" }));
        await hidden();
        expect(results).toEqual([ true ]);
    });

    it("resolves false when closed after a download ends without every resource it needs", async () => {
        mocks.post.mockResolvedValue(progress());
        mocks.get.mockResolvedValue(STATUS);
        await open();
        await click("resource_download.download");

        await send(progress({ status: "succeeded" }));
        await hidden();
        expect(results).toEqual([ false ]);
    });

    it("marks each resource done as the download moves on, the one downloading with its bar", async () => {
        const vad = { ...STATUS.resources[0], id: "transcription.vad", title: "VAD", downloadedSize: 0 };
        mocks.post.mockResolvedValue(progress());
        await open({ ...STATUS, resources: [ ...STATUS.resources, vad ] });
        await click("resource_download.download");

        await send(progress({ resources: [
            { id: "transcription.model", receivedBytes: 700, totalBytes: 700, done: true },
            { id: "transcription.vad", receivedBytes: 100, totalBytes: 700, done: false }
        ] }));
        const [ first, second ] = container.querySelectorAll(".resource-download-item");
        expect(first.querySelector(".resource-download-icon")?.classList).toContain("bx-check-circle");
        expect(first.querySelector("[role=progressbar]")).toBeNull();
        expect(second.querySelector(".resource-download-icon")?.classList).toContain("bx-loader-circle");
        expect(second.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("100");

        await send(progress({ status: "failed", error: "offline", resources: [
            { id: "transcription.model", receivedBytes: 700, totalBytes: 700, done: true },
            { id: "transcription.vad", receivedBytes: 100, totalBytes: 700, done: false }
        ] }));
        expect(second.querySelector(".resource-download-icon")?.classList).toContain("bx-circle");
        expect(container.querySelector("[role=progressbar]")).toBeNull();
    });

    it("keeps an end reported before the request that started the download returns", async () => {
        let respond = (_value: ResourceDownloadProgress) => {};
        mocks.post.mockReturnValue(new Promise((resolve) => respond = resolve));
        await open();

        await click("resource_download.download");
        await send(progress({ status: "failed", error: "checksum" }));
        await act(async () => respond(progress()));

        expect(text(".admonition.caution")).toContain("checksum");
        expect(findButton("resource_download.retry")).toBeDefined();
    });

    it("offers to check files already on the device instead of downloading them", async () => {
        const copied = { ...STATUS.resources[0], downloadedSize: 0, unverifiedSize: 700 };
        await open({ ...STATUS, resources: [ copied ], freeBytes: 100 });

        expect(text(".resource-download-meta")).toContain(`resource_download.unverified:{"size":"700 B"}`);
        expect(text(".resource-download-item .resource-download-size")).toBe("0 B");
        expect(text(".resource-download-total .resource-download-size")).toBe("0 B");
        expect(container.querySelector(".admonition")).toBeNull();
        expect(findButton("resource_download.download")).toBeUndefined();
        expect(findButton("resource_download.verify")?.disabled).toBe(false);
    });

    it("refuses to start a download that cannot fit in the free space", async () => {
        await open({ ...STATUS, freeBytes: 100 });

        expect(text(".admonition.caution")).toContain(`"size":"500 B","free":"100 B"`);
        expect(findButton("resource_download.download")?.disabled).toBe(true);
    });

    it("cancels the running download when closed, and resolves false", async () => {
        mocks.post.mockResolvedValue(progress());
        await open();
        await click("resource_download.download");
        expect(findButton("resource_download.download")).toBeUndefined();

        await hidden();

        expect(mocks.post).toHaveBeenLastCalledWith("resources/download/d1/cancel");
        expect(results).toEqual([ false ]);
    });

    it("cancels a download whose start returns after the dialog closed", async () => {
        let respond = (_value: ResourceDownloadProgress) => {};
        mocks.post.mockReturnValueOnce(new Promise((resolve) => respond = resolve));
        await open();
        await click("resource_download.download");

        await hidden();
        await act(async () => respond(progress()));

        expect(mocks.post).toHaveBeenLastCalledWith("resources/download/d1/cancel");
        expect(results).toEqual([ false ]);
    });

    it("downloads nothing more once closed while it checks a finished download", async () => {
        let respond = (_value: ResourcesStatusResponse) => {};
        mocks.post.mockResolvedValue(progress());
        mocks.get.mockReturnValueOnce(new Promise((resolve) => respond = resolve));
        await open();
        await click("resource_download.download");
        await send(progress({ status: "succeeded" }));

        await hidden();
        await act(async () => respond(STATUS));

        expect(mocks.post).toHaveBeenCalledOnce();
        expect(results).toEqual([ false ]);
    });

    async function open(status = STATUS, ids = [ "transcription.model" ]) {
        await act(async () => {
            await host.handleEvent("showResourceDownloadDialog", {
                ids,
                status,
                callback: (installed: boolean) => results.push(installed)
            });
        });
    }

    async function send(download: ResourceDownloadProgress) {
        await act(async () => {
            for (const handler of mocks.handlers) {
                handler({ type: "resource-download", download });
            }
        });
    }

    async function click(label: string) {
        const button = findButton(label);
        expect(button).toBeDefined();
        await act(async () => button?.click());
    }

    /** Bootstrap fires this when the dialog closes; the test sends it instead. */
    async function hidden() {
        const dialog = container.querySelector(".resource-download-dialog");
        expect(dialog).not.toBeNull();
        await act(async () => {
            dialog?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true }));
        });
    }

    function text(selector: string) {
        return container.querySelector(selector)?.textContent ?? "";
    }

    function findButton(label: string) {
        return [ ...container.querySelectorAll("button") ]
            .find((candidate) => candidate.textContent?.includes(label));
    }
});

function installed(status: ResourcesStatusResponse): ResourcesStatusResponse {
    return {
        ...status,
        resources: status.resources.map((resource) => ({
            ...resource, installed: true, downloadedSize: resource.size, unverifiedSize: 0, directory: `/resources/${resource.id}`
        }))
    };
}

function progress(overrides: Partial<ResourceDownloadProgress> = {}): ResourceDownloadProgress {
    const receivedBytes = overrides.receivedBytes ?? 0;
    return {
        downloadId: "d1",
        resourceIds: [ "transcription.model" ],
        status: "downloading",
        receivedBytes,
        totalBytes: 700,
        file: null,
        resources: [ {
            id: "transcription.model",
            receivedBytes,
            totalBytes: 700,
            done: overrides.status === "succeeded"
        } ],
        ...overrides
    };
}
