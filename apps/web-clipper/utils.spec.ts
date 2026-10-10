import type { Window as HappyDOMWindow } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { createLink, getBaseUrl, getPageLocationOrigin, randomString } from "./utils";

describe("randomString", () => {
    it("returns alphanumeric strings of the requested length", () => {
        expect(randomString(0)).toBe("");
        expect(randomString(20)).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(randomString(20)).not.toBe(randomString(20));
    });
});

describe("page location", () => {
    afterEach(() => setUrl("about:blank"));

    it("strips the file name from the base URL", () => {
        setUrl("https://example.com:8080/dir/page.html?q=1#hash");
        expect(getPageLocationOrigin()).toBe("https://example.com:8080");
        expect(getBaseUrl()).toBe("https://example.com:8080/dir");

        setUrl("https://example.com/dir/");
        expect(getBaseUrl()).toBe("https://example.com/dir/");
    });

    it("uses file:// as the origin of local files", () => {
        setUrl("file:///home/user/page.html");
        expect(getPageLocationOrigin()).toBe("file://");
        expect(getBaseUrl()).toBe("file:///home/user");
    });
});

describe("createLink", () => {
    it("sends the click action to the extension", () => {
        const sendMessage = vi.spyOn(fakeBrowser.runtime, "sendMessage")
            .mockResolvedValue(undefined);
        const action = { name: "openNoteInTrilium", noteId: "abc" };

        const link = createLink(action, "Open");
        expect(link.textContent).toBe("Open");
        expect(link.style.color).toBe("lightskyblue");
        expect(createLink(action, "Close", "tomato").style.color).toBe("tomato");

        link.click();
        expect(sendMessage).toHaveBeenCalledWith(null, action);
    });
});

function setUrl(url: string) {
    (window as unknown as HappyDOMWindow).happyDOM.setURL(url);
}
