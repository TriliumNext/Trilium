import { Modal as BootstrapModal } from "bootstrap";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import YouTubeVideoDialog, { getYouTubeVideoUrl, YouTubeVideoBalloon } from "./youtube_video";

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../services/toast", () => ({ default: { showError } }));
// Raises the modal at once, so that it has the Bootstrap instance it closes through.
vi.mock("../../services/dialog", () => ({
    openDialog: async (dialog: JQuery<HTMLElement>) => dialog
}));

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
});

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("getYouTubeVideoUrl", () => {
    it("accepts the address of a YouTube video, adding https:// when it names no scheme", () => {
        expect(getYouTubeVideoUrl(` ${VIDEO_URL} `)).toBe(VIDEO_URL);
        expect(getYouTubeVideoUrl("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
        expect(getYouTubeVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
            .toBe("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    });

    it("rejects an empty field, another site, and an address that is not a web page", () => {
        expect(getYouTubeVideoUrl("  ")).toBeNull();
        expect(getYouTubeVideoUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
        expect(getYouTubeVideoUrl("https://www.youtube.com/")).toBeNull();
        expect(getYouTubeVideoUrl("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ"))
            .toBeNull();
    });
});

describe("YouTubeVideoBalloon", () => {
    const onInsert = vi.fn(async (_url: string) => {});

    beforeEach(() => {
        vi.clearAllMocks();
        onInsert.mockReset();
    });

    it("disables Insert while the video loads, and shows a toast when it fails", async () => {
        const insertion = deferInsertion(onInsert);
        let container = document.body;
        await act(async () => {
            container = renderInto(<YouTubeVideoBalloon onInsert={onInsert} />);
        });
        const form = container.querySelector("form");
        if (!form) throw new Error("The balloon has no form.");
        await type(container.querySelector(".youtube-video-url input"), VIDEO_URL);

        await submit(form);
        expect(insertButton(container)?.disabled).toBe(true);
        await submit(form);
        expect(onInsert).toHaveBeenCalledExactlyOnceWith(VIDEO_URL);

        await insertion.fail();
        expect(showError).toHaveBeenCalledExactlyOnceWith("youtube_video.insert_failed");
        expect(insertButton(container)?.disabled).toBe(false);

        await submit(form);
        await insertion.succeed();
        expect(onInsert).toHaveBeenCalledTimes(2);
        expect(showError).toHaveBeenCalledOnce();
    });

    it("focuses the field, and inserts only the address of a video", async () => {
        let container = document.body;
        await act(async () => {
            container = renderInto(<YouTubeVideoBalloon onInsert={onInsert} />);
        });
        const form = container.querySelector("form");
        const field = container.querySelector<HTMLInputElement>(".youtube-video-url input");
        if (!form || !field) throw new Error("The balloon has no form.");
        expect(document.activeElement).toBe(field);
        expect(insertButton(container)?.disabled).toBe(true);
        expect(errorOf(container)).toBeUndefined();

        await type(field, "https://example.com");
        expect(insertButton(container)?.disabled).toBe(true);
        expect(errorOf(container)).toBe("youtube_video.not_a_video");
        expect(container.querySelector(".youtube-video-url .tn-card-option-description"))
            .toBeNull();
        expect(document.activeElement).toBe(field);
        await submit(form);
        expect(onInsert).not.toHaveBeenCalled();

        await type(field, "youtu.be/dQw4w9WgXcQ");
        expect(insertButton(container)?.disabled).toBe(false);
        expect(errorOf(container)).toBeUndefined();
        await submit(form);
        expect(onInsert).toHaveBeenCalledExactlyOnceWith("https://youtu.be/dQw4w9WgXcQ");
    });
});

describe("YouTubeVideoDialog", () => {
    const onInsert = vi.fn(async (_url: string) => {});
    let host: Component;
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        onInsert.mockReset();
        vi.spyOn(BootstrapModal.prototype, "hide").mockImplementation(() => {});
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <YouTubeVideoDialog />
            </ParentComponent.Provider>
        );
    });

    async function open() {
        await act(async () => {
            void host.handleEventInChildren("showYouTubeVideoDialog", { onInsert });
        });
    }

    function field() {
        return container.querySelector<HTMLInputElement>(".youtube-video-url input");
    }

    async function hide() {
        await act(async () => {
            container.querySelector(".modal")?.dispatchEvent(new Event("hidden.bs.modal"));
        });
    }

    it("closes once the video is inserted, and stays open with a toast when it fails", async () => {
        const insertion = deferInsertion(onInsert);
        await open();
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");

        await type(field(), VIDEO_URL);
        await submit(form);
        expect(onInsert).toHaveBeenCalledExactlyOnceWith(VIDEO_URL);
        expect(insertButton(container)?.disabled).toBe(true);
        await insertion.fail();
        expect(showError).toHaveBeenCalledExactlyOnceWith("youtube_video.insert_failed");
        expect(insertButton(container)?.disabled).toBe(false);
        expect(BootstrapModal.prototype.hide).not.toHaveBeenCalled();

        await submit(form);
        expect(onInsert).toHaveBeenCalledTimes(2);
        expect(BootstrapModal.prototype.hide).not.toHaveBeenCalled();
        await insertion.succeed();
        expect(BootstrapModal.prototype.hide).toHaveBeenCalledOnce();
        await hide();

        await open();
        expect(field()?.value).toBe("");
    });

    it("inserts nothing when the modal is closed without the video", async () => {
        await open();
        await type(field(), VIDEO_URL);
        await hide();

        expect(onInsert).not.toHaveBeenCalled();
    });
});

/**
 * Makes each call of `onInsert` wait until `succeed()` or `fail()` settles it. Both wait a task,
 * so that what the component does after the insertion renders before they return.
 */
function deferInsertion(onInsert: Mock<(url: string) => Promise<void>>) {
    let settle: (error?: Error) => void = () => {};
    onInsert.mockImplementation(() => new Promise<void>((resolve, reject) => {
        settle = (error) => error ? reject(error) : resolve();
    }));
    const settleWith = (error?: Error) => act(async () => {
        settle(error);
        await new Promise((resolve) => setTimeout(resolve));
    });
    return {
        succeed: () => settleWith(),
        fail: () => settleWith(new Error("Offline"))
    };
}

function insertButton(container: HTMLElement) {
    return container.querySelector<HTMLButtonElement>("button[type=submit]");
}

/** The error shown under the URL field, if any. */
function errorOf(container: HTMLElement) {
    return container.querySelector(".youtube-video-url > input + .form-field-error")
        ?.textContent ?? undefined;
}

async function submit(form: HTMLFormElement) {
    await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
}

async function type(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("The field is not shown.");
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
