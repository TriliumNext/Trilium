import type { FUniver } from "@univerjs/presets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { showError } from "../../../services/toast";
import { installFileLinkHandler } from "./file_links";

vi.mock("../../../services/toast", () => ({ showError: vi.fn() }));
vi.mock("../../../services/i18n", () => ({
    t: (key: string, params: Record<string, unknown>) => `${key}: ${JSON.stringify(params)}`
}));

const realWindow = window as any;

interface FakeResolver {
    navigateToOtherWebsite: (url: string) => Promise<void>;
}

function createApi(resolver: FakeResolver, options: { registered?: () => boolean } = {}) {
    let listener: ((event: { stage: string }) => void) | undefined;
    const dispose = vi.fn();
    const api = {
        _injector: {
            has: options.registered ?? (() => true),
            get: () => resolver
        },
        addEvent: (_event: string, callback: (event: { stage: string }) => void) => {
            listener = callback;
            return { dispose };
        },
        Event: { LifeCycleChanged: "lifecycle-changed" },
        Enum: { LifecycleStages: { Rendered: "rendered" } }
    } as unknown as FUniver;
    return { api, dispose, emitStage: (stage: string) => listener?.({ stage }) };
}

function createResolver(): FakeResolver {
    return { navigateToOtherWebsite: vi.fn(async () => {}) };
}

describe("installFileLinkHandler", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(showError).mockClear();
        delete realWindow.electronApi;
    });

    it("opens a file: hyperlink through the desktop bridge, reporting a refusal", async () => {
        const openFileUrl = vi.fn(async () => "UNC path blocked");
        realWindow.electronApi = { shell: { openFileUrl } };
        const resolver = createResolver();

        installFileLinkHandler(createApi(resolver).api);
        await resolver.navigateToOtherWebsite("file:///home/x/job.pdf");

        expect(openFileUrl).toHaveBeenCalledWith("file:///home/x/job.pdf");
        expect(showError).toHaveBeenCalledOnce();
    });

    it("reports nothing when the file opens", async () => {
        const openFileUrl = vi.fn(async () => "");
        realWindow.electronApi = { shell: { openFileUrl } };
        const resolver = createResolver();

        installFileLinkHandler(createApi(resolver).api);
        await resolver.navigateToOtherWebsite("file:///home/x/job.pdf");

        expect(openFileUrl).toHaveBeenCalledOnce();
        expect(showError).not.toHaveBeenCalled();
    });

    it("hands every other URL back to Univer", async () => {
        const openFileUrl = vi.fn();
        realWindow.electronApi = { shell: { openFileUrl } };
        const original = vi.fn(async () => {});
        const resolver: FakeResolver = { navigateToOtherWebsite: original };

        installFileLinkHandler(createApi(resolver).api);
        await resolver.navigateToOtherWebsite("https://example.com/job");

        expect(original).toHaveBeenCalledWith("https://example.com/job");
        expect(openFileUrl).not.toHaveBeenCalled();
    });

    it("reports a rejection from the desktop bridge", async () => {
        const openFileUrl = vi.fn()
            .mockRejectedValueOnce(new Error("no handler"))
            .mockRejectedValueOnce("raw failure");
        realWindow.electronApi = { shell: { openFileUrl } };
        const resolver = createResolver();

        installFileLinkHandler(createApi(resolver).api);
        await resolver.navigateToOtherWebsite("file:///home/x/job.pdf");
        await resolver.navigateToOtherWebsite("file:///home/x/job.pdf");

        const [ first, second ] = vi.mocked(showError).mock.calls.map(([ message ]) => message);
        expect(first).toContain("file:///home/x/job.pdf");
        expect(first).toContain("no handler");
        expect(second).toContain("raw failure");
    });

    it("disposes the lifecycle listener it registers", () => {
        const { api, dispose } = createApi(createResolver());

        installFileLinkHandler(api)();

        expect(dispose).toHaveBeenCalledOnce();
    });

    it("falls back to window.open in the browser", async () => {
        const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
        const resolver = createResolver();

        installFileLinkHandler(createApi(resolver).api);
        await resolver.navigateToOtherWebsite("file:///home/x/job.pdf");

        expect(openSpy).toHaveBeenCalledWith(
            "file:///home/x/job.pdf", "_blank", "noopener,noreferrer"
        );
    });

    it("installs at the rendered stage when the hyperlink service is not registered yet", () => {
        let registered = false;
        const resolver = createResolver();
        const original = resolver.navigateToOtherWebsite;
        const { api, emitStage } = createApi(resolver, { registered: () => registered });

        installFileLinkHandler(api);
        expect(resolver.navigateToOtherWebsite).toBe(original);

        emitStage("ready");
        expect(resolver.navigateToOtherWebsite).toBe(original);

        registered = true;
        emitStage("rendered");
        const patched = resolver.navigateToOtherWebsite;
        expect(patched).not.toBe(original);

        // A second rendered stage must not wrap the method again.
        emitStage("rendered");
        expect(resolver.navigateToOtherWebsite).toBe(patched);
    });
});
