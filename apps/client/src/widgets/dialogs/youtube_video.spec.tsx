import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import YouTubeVideoDialog, { getYouTubeVideoUrl, YouTubeVideoBalloon } from "./youtube_video";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

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
    const onInsert = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
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
        expect(description(container)).toBeUndefined();

        await type(field, "https://example.com");
        expect(insertButton(container)?.disabled).toBe(true);
        expect(description(container)).toBe("youtube_video.not_a_video");
        await submit(form);
        expect(onInsert).not.toHaveBeenCalled();

        await type(field, "youtu.be/dQw4w9WgXcQ");
        expect(insertButton(container)?.disabled).toBe(false);
        expect(description(container)).toBeUndefined();
        await submit(form);
        expect(onInsert).toHaveBeenCalledExactlyOnceWith("https://youtu.be/dQw4w9WgXcQ");
    });
});

describe("YouTubeVideoDialog", () => {
    const onInsert = vi.fn();
    let host: Component;
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
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

    it("inserts the video once the modal is gone, and opens again on an empty field", async () => {
        await open();
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");

        await type(field(), VIDEO_URL);
        await submit(form);
        expect(onInsert).not.toHaveBeenCalled();
        await hide();
        expect(onInsert).toHaveBeenCalledExactlyOnceWith(VIDEO_URL);

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

function insertButton(container: HTMLElement) {
    return container.querySelector<HTMLButtonElement>("button[type=submit]");
}

/** The text under the label of the URL field, if any. */
function description(container: HTMLElement) {
    return container.querySelector(".youtube-video-url .tn-card-option-description")
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
