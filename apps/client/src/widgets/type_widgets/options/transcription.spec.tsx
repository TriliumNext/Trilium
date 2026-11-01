import $ from "jquery";
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    stored: "" as string,
    saved: [] as string[],
    bools: {} as Record<string, boolean>,
    getRecordingsDirectory: vi.fn(),
    isSupported: vi.fn(),
    savedBools: [] as [ string, boolean ][],
    getResources: vi.fn()
}));

// Bootstrap places the menu against a real layout, which happy-dom has none of.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ show() {}, hide() {}, update() {}, dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

vi.mock("../../../services/server", () => ({
    default: {
        get: (url: string) => (url.startsWith("resources")
            ? mocks.getResources(url)
            : Promise.resolve([]))
    }
}));

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        name === "transcriptionModel" ? mocks.stored : "",
        (value: string) => void mocks.saved.push(value)
    ],
    useTriliumOptionBool: (name: string) => [
        mocks.bools[name] ?? false,
        (value: boolean) => void mocks.savedBools.push([ name, value ])
    ],
    useStaticTooltip: vi.fn(),
    useTooltip: () => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() })
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ badge, below }: { badge?: ComponentChildren; below?: ComponentChildren }) =>
        <div className="header-stub">{badge}{below}</div>
}));

import { formatSize } from "../../../services/utils";
import TranscriptionSettings from "./transcription";

globalThis.ResizeObserver = globalThis.ResizeObserver ?? (class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver);

const INT8_SIZE = 670_478_772;
const FP32_SIZE = 2_549_800_429;

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.stored = "parakeet-fp32";
    mocks.saved = [];
    mocks.bools = {
        transcriptionEnabled: true, transcriptionSpeakersEnabled: true, transcriptionKeepRecordings: false
    };
    mocks.savedBools = [];
    mocks.getRecordingsDirectory.mockReset().mockResolvedValue("/data/transcription-recordings");
    mocks.getResources.mockReset().mockResolvedValue({
        resources: [
            { id: "transcription.parakeet", size: INT8_SIZE },
            { id: "transcription.parakeet-fp32", size: FP32_SIZE }
        ],
        freeBytes: null,
        download: null
    });
    mocks.isSupported.mockReset().mockResolvedValue(true);
    window.electronApi = {
        transcription: {
            getRecordingsDirectory: mocks.getRecordingsDirectory,
            isSupported: mocks.isSupported
        }
    } as unknown as typeof window.electronApi;
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    window.electronApi = undefined;
    document.body.innerHTML = "";
});

function open() {
    act(() => {
        render(<TranscriptionSettings />, host);
    });
    return host.querySelector<HTMLElement>(".transcription-model-picker");
}

/** Opens the model picker's menu and returns its rows, which it places in the body. */
function openModelMenu() {
    const toggle = host.querySelector(".transcription-model-picker > button");
    if (!toggle) {
        throw new Error("The model picker is missing.");
    }
    act(() => {
        $(toggle).trigger("click");
    });
    return [ ...document.querySelectorAll<HTMLElement>(".dropdown-item") ];
}

describe("TranscriptionSettings", () => {
    it("offers each model with its size and what it is, and saves another choice", async () => {
        const picker = open();
        await act(async () => {});
        expect(mocks.getResources).toHaveBeenCalledExactlyOnceWith(
            "resources?ids=transcription.parakeet,transcription.parakeet-fp32");
        expect(picker?.querySelector("button")?.textContent)
            .toBe("transcription_options.model_high_accuracy");

        const items = openModelMenu();
        expect(items.map((item) => item.querySelector(".description")?.textContent)).toEqual([
            "transcription_options.model_standard_description\n"
                + `transcription_options.model_size {"size":"${formatSize(INT8_SIZE, 1)}"}`,
            "transcription_options.model_high_accuracy_description\n"
                + `transcription_options.model_size {"size":"${formatSize(FP32_SIZE, 1)}"}`
        ]);

        act(() => {
            items[0].click();
        });
        expect(mocks.saved).toEqual([ "parakeet-int8" ]);
    });

    it("leaves the size out where the resources cannot be read", async () => {
        mocks.getResources.mockRejectedValue(new Error("offline"));
        open();
        await act(async () => {});
        expect(openModelMenu()[0].querySelector(".description")?.textContent)
            .toBe("transcription_options.model_standard_description");
    });

    it("turns speaker identification off", () => {
        open();
        const toggle = findToggle("identify-speakers");
        expect(toggle.checked).toBe(true);

        act(() => {
            toggle.checked = false;
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(mocks.savedBools).toEqual([ [ "transcriptionSpeakersEnabled", false ] ]);
    });

    it("keeps recordings for troubleshooting on request, on a switch tinted as a warning", async () => {
        open();
        const toggle = findToggle("keep-recordings");
        expect(toggle.checked).toBe(false);
        expect(toggle.closest(".transcription-keep-recordings")).not.toBeNull();

        act(() => {
            toggle.checked = true;
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(mocks.savedBools).toEqual([ [ "transcriptionKeepRecordings", true ] ]);
    });

    it("warns about consent beside the switch that keeps recordings, before it is turned on", () => {
        open();
        const warning = host.querySelector(".transcription-keep-recordings-warning");
        expect(warning?.querySelector(".admonition")).toBeNull();
        expect(warning?.querySelector(".tn-icon.bx-error")).not.toBeNull();
        expect(warning?.textContent).toBe("transcription_options.keep_recordings_warning");
        // Outside the label, so that pressing the warning does not operate the switch.
        expect(warning?.closest("label")).toBeNull();
    });

    it("asks for the recordings folder, which creates it, only while recordings are kept", async () => {
        open();
        await act(async () => {});
        expect(mocks.getRecordingsDirectory).not.toHaveBeenCalled();
        expect(host.querySelector(".directory-location")).toBeNull();

        act(() => render(null, host));
        mocks.bools.transcriptionKeepRecordings = true;
        open();
        await act(async () => {});
        expect(mocks.getRecordingsDirectory).toHaveBeenCalledOnce();
        expect(host.querySelector(".directory-location-path")?.textContent).toBe("/data/transcription-recordings");
    });

    it("marks the page as beta, and introduces it only through the switch below the title", () => {
        open();
        const header = host.querySelector(".header-stub");
        expect(header?.querySelector(".ext-badge")?.textContent).toBe("common.beta");
        expect(header?.querySelector("p")).toBeNull();
        expect(header?.textContent).toContain("transcription_options.enabled_description");
    });

    it("offers only the switch that turns transcription on while it is off", () => {
        mocks.bools.transcriptionEnabled = false;
        open();
        expect(host.querySelector(".transcription-model-picker")).toBeNull();
        expect(host.querySelector("input.switch-toggle[id^='keep-recordings-']")).toBeNull();

        const toggle = findToggle("transcription-enabled");
        expect(toggle.checked).toBe(false);
        act(() => {
            toggle.checked = true;
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(mocks.savedBools).toEqual([ [ "transcriptionEnabled", true ] ]);
    });

    it("points to the downloaded resources, whether transcription is on or off", () => {
        for (const isEnabled of [ true, false ]) {
            mocks.bools.transcriptionEnabled = isEnabled;
            open();
            const link = host.querySelector("a[href='#root/_hidden/_options/_optionsResources']");
            expect(link?.textContent).toContain("transcription_options.related_resources");
            act(() => render(null, host));
        }
    });

    it("shows the default model for a value it does not know", () => {
        mocks.stored = "whisper";
        expect(open()?.querySelector("button")?.textContent)
            .toContain("transcription_options.model_standard");
    });

    it("explains that this computer cannot transcribe, in place of the settings", async () => {
        mocks.isSupported.mockResolvedValue(false);
        expect(open()).not.toBeNull();
        await act(async () => {});
        expect(host.querySelector(".transcription-model-picker")).toBeNull();
        expect(host.querySelector("input.switch-toggle[id^='transcription-enabled-']")).toBeNull();
        expect(host.textContent).toContain("transcription_options.unsupported");
    });

    it("explains that the page applies to desktop builds only, elsewhere", () => {
        mocks.electron = false;
        expect(open()).toBeNull();
        expect(host.textContent).toContain("desktop.web_placeholder");
    });
});

/** The switch of the section `name`, whose id is `<name>-<random>`. */
function findToggle(name: string) {
    const toggle = host.querySelector<HTMLInputElement>(`input.switch-toggle[id^='${name}-']`);
    if (!toggle) {
        throw new Error(`The ${name} switch is missing.`);
    }
    return toggle;
}
