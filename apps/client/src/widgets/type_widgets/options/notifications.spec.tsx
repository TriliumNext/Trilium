import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    upload: vi.fn(async (_file: File) => {}),
    reset: vi.fn(async () => {}),
    showError: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../services/notification_sound", () => ({
    getCustomSoundUrl: (version?: string) => `api/notifications/sound?v=${version}`,
    uploadCustomSound: mocks.upload,
    resetCustomSound: mocks.reset
}));
vi.mock("../../../services/toast", () => ({
    default: { showError: mocks.showError, showMessage: vi.fn() }
}));
vi.mock("./components/OptionsPageHeader", () => ({
    default: () => <div className="header-stub" />
}));
vi.mock("./notification_channels/ChannelsCard", () => ({
    default: () => <div className="channels-card-stub" />
}));

import { NotificationRequestError } from "../../../services/notifications";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import NotificationSettings from "./notifications";

class FakeAudio {

    static instances: FakeAudio[] = [];
    readonly play = vi.fn(async () => {});
    readonly pause = vi.fn();

    constructor(readonly src: string) {
        FakeAudio.instances.push(this);
    }

}

let save: MockInstance<typeof options.save>;

beforeEach(() => {
    options.set("notificationSoundEnabled", "true");
    options.set("notificationDisabledCategories", "[]");
    save = vi.spyOn(options, "save").mockResolvedValue(undefined);
    vi.stubGlobal("Audio", FakeAudio);
    FakeAudio.instances = [];
    withCustomSound(null);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.upload.mockReset();
    mocks.reset.mockReset();
    mocks.showError.mockReset();
});

/** Puts `_resources` in froca, with the custom sound when `content` is a string. */
function withCustomSound(content: string | null) {
    buildNote({
        id: "_resources",
        title: "Resources",
        children: content === null ? [] : [ {
            id: "_notificationSound", title: "Notification Sound", type: "file",
            mime: "audio/mpeg", content
        } ]
    });
}

async function open() {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NotificationSettings />);
    });
    // `useChildNotes()` reads `_resources`, then `useNoteBlob()` the sound, each after a render.
    for (let round = 0; round < 3; round++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    if (!container) {
        throw new Error("The page was not rendered");
    }
    return container;
}

function soundRow(page: HTMLElement) {
    return page.querySelector(".custom-notification-sound");
}

function button(page: HTMLElement, name: string) {
    return page.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
}

function toggleOf(page: HTMLElement, name: string) {
    const input = page.querySelector<HTMLInputElement>(`input[id^="${name}-"]`);
    if (!input) {
        throw new Error(`No toggle for ${name}`);
    }
    return input;
}

async function flip(input: HTMLInputElement) {
    await act(async () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function pick(page: HTMLElement, file: File) {
    const input = soundRow(page)?.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) {
        throw new Error("No file input");
    }
    expect(input.accept).toContain("audio/mpeg");
    Object.defineProperty(input, "files", { value: [ file ], configurable: true });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

describe("the alerts card", () => {
    it("switches the sound alerts, and hides the custom sound while they are off", async () => {
        const page = await open();
        const sound = toggleOf(page, "notification-sound");
        expect(sound.checked).toBe(true);
        expect(soundRow(page)).not.toBeNull();

        await flip(sound);
        expect(save).toHaveBeenCalledWith("notificationSoundEnabled", "false");
        expect(soundRow(page)).toBeNull();
    });

    it("offers Browse without a custom sound, and Play and Reset to default with one", async () => {
        const unset = await open();
        expect(button(unset, "browse-notification-sound-button")).not.toBeNull();
        expect(button(unset, "play-notification-sound-button")).toBeNull();

        withCustomSound("ID3");
        const set = await open();
        expect(button(set, "browse-notification-sound-button")).toBeNull();
        expect(button(set, "play-notification-sound-button")).not.toBeNull();
        expect(button(set, "reset-notification-sound-button")).not.toBeNull();

        // A reset leaves the note empty, and an empty note is no custom sound.
        withCustomSound("");
        expect(button(await open(), "browse-notification-sound-button")).not.toBeNull();
    });

    it("uploads the picked file, and says why a refused one was not saved", async () => {
        const page = await open();
        const file = new File([ "ID3" ], "chime.mp3", { type: "audio/mpeg" });
        await pick(page, file);
        expect(mocks.upload).toHaveBeenCalledWith(file);
        // The buttons follow the upload before froca brings the note.
        expect(button(page, "play-notification-sound-button")).not.toBeNull();

        const refusing = await open();
        for (const [ code, message ] of [
            [ "unsupported-format", "notification_settings.sound_unsupported" ],
            [ "too-large", "notification_settings.sound_too_large" ],
            [ "internal", "notification_settings.sound_upload_failed" ]
        ] as const) {
            mocks.upload.mockRejectedValueOnce(new NotificationRequestError(code));
            await pick(refusing, file);
            expect(mocks.showError).toHaveBeenLastCalledWith(message);
        }
        expect(button(refusing, "browse-notification-sound-button")).not.toBeNull();
    });

    it("plays the custom sound, and resets it to the default one", async () => {
        withCustomSound("ID3");
        const page = await open();
        await act(async () => button(page, "play-notification-sound-button")?.click());
        const [ first ] = FakeAudio.instances;
        expect(first.src).toMatch(/^api\/notifications\/sound\?v=\w+$/);
        expect(first.play).toHaveBeenCalled();

        // A second press stops the sound and plays it from its start.
        await act(async () => button(page, "play-notification-sound-button")?.click());
        expect(first.pause).toHaveBeenCalled();
        expect(FakeAudio.instances).toHaveLength(2);

        await act(async () => button(page, "reset-notification-sound-button")?.click());
        expect(mocks.reset).toHaveBeenCalled();
        expect(button(page, "browse-notification-sound-button")).not.toBeNull();
    });

    it("says when the custom sound does not play, and not when a press interrupts it", async () => {
        withCustomSound("ID3");
        const page = await open();
        for (const [ name, isReported ] of [
            [ "AbortError", false ], [ "NotSupportedError", true ]
        ] as const) {
            vi.stubGlobal("Audio", class {
                pause = vi.fn();
                play = vi.fn(async () => {
                    throw Object.assign(new Error(name), { name });
                });
            });
            mocks.showError.mockClear();
            await act(async () => button(page, "play-notification-sound-button")?.click());
            expect(mocks.showError.mock.calls, name)
                .toEqual(isReported ? [ [ "notification_settings.sound_play_failed" ] ] : []);
        }
    });
});

describe("the channels card", () => {
    it("loads below the other cards", async () => {
        const page = await open();
        expect(page.lastElementChild?.querySelector(".channels-card-stub")).not.toBeNull();
    });
});

describe("the categories card", () => {
    it("turns a category off and on, keeping the names this client does not know", async () => {
        options.set("notificationDisabledCategories", JSON.stringify([ "later" ]));
        const off = await open();
        const general = toggleOf(off, "notification-category-general");
        expect(general.checked).toBe(true);
        await flip(general);
        expect(save).toHaveBeenLastCalledWith("notificationDisabledCategories",
            JSON.stringify([ "later", "general" ]));

        options.set("notificationDisabledCategories", JSON.stringify([ "later", "general" ]));
        const on = await open();
        const generalAgain = toggleOf(on, "notification-category-general");
        expect(generalAgain.checked).toBe(false);
        expect(toggleOf(on, "notification-category-reminder").checked).toBe(true);
        await flip(generalAgain);
        expect(save).toHaveBeenLastCalledWith("notificationDisabledCategories",
            JSON.stringify([ "later" ]));
    });

    it("reads a value that does not parse as nothing turned off, as the backend does", async () => {
        options.set("notificationDisabledCategories", "{");
        const page = await open();
        for (const category of [ "general", "reminder", "softwareUpdate" ]) {
            expect(toggleOf(page, `notification-category-${category}`).checked).toBe(true);
        }
    });
});
