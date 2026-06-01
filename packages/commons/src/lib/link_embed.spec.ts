import { describe, expect, it } from "vitest";

import { extractYouTubeVideoId, YOUTUBE_REGEX } from "./link_embed.js";

describe("extractYouTubeVideoId", () => {
    it("extracts the id from a standard watch URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a youtu.be short link", () => {
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from an embed URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a shorts URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a watch URL with extra query params around v=", () => {
        expect(
            extractYouTubeVideoId("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10s")
        ).toBe("dQw4w9WgXcQ");
    });

    it("returns null for a non-YouTube URL", () => {
        expect(extractYouTubeVideoId("https://example.com/foo")).toBeNull();
    });
});

describe("YOUTUBE_REGEX", () => {
    it("is a RegExp that matches a known YouTube URL", () => {
        expect(YOUTUBE_REGEX).toBeInstanceOf(RegExp);

        const match = "https://www.youtube.com/watch?v=dQw4w9WgXcQ".match(YOUTUBE_REGEX);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("dQw4w9WgXcQ");
    });
});
