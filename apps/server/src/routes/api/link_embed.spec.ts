import { describe, expect, it } from "vitest";

import { extractYouTubeVideoId } from "@triliumnext/commons";

describe("extractYouTubeVideoId", () => {
    it("extracts ID from standard watch URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from short URL", () => {
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from embed URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from shorts URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("returns null for non-YouTube URLs", () => {
        expect(extractYouTubeVideoId("https://example.com")).toBeNull();
        expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
    });
});
