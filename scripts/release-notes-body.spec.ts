import { describe, expect, it } from "vitest";

import { rewriteImageSources } from "./release-notes-body.mjs";

const OPTIONS = { repository: "TriliumNext/Trilium", tag: "v0.105.0" };
const BASE = "https://raw.githubusercontent.com/TriliumNext/Trilium/refs/tags/v0.105.0/docs/Release%20Notes/Release%20Notes";

describe("rewriteImageSources", () => {
    it("pins relative sources to the tag, in both the exported and the Markdown form", () => {
        const { body, images } = rewriteImageSources([
            `<figure class="image image_resized" style="width:45.59%;"><img style="aspect-ratio:1509/1329;" src="v0.105.0_image.png" width="1509" height="1329"></figure>`,
            `![A screenshot](1_v0.105.0_image.png "The title")`
        ].join("\n"), OPTIONS);

        expect(body).toBe([
            `<figure class="image image_resized" style="width:45.59%;"><img style="aspect-ratio:1509/1329;" src="${BASE}/v0.105.0_image.png" width="1509" height="1329"></figure>`,
            `![A screenshot](${BASE}/1_v0.105.0_image.png "The title")`
        ].join("\n"));
        expect(images).toEqual([
            "docs/Release Notes/Release Notes/v0.105.0_image.png",
            "docs/Release Notes/Release Notes/1_v0.105.0_image.png"
        ]);
    });

    it("leaves sources that are already absolute alone", () => {
        const note = [
            `<img src="https://github.com/user-attachments/assets/25f916f8.png">`,
            `<img src="//example.com/hosted.png">`,
            `<img src="data:image/png;base64,AAAA">`,
            `![Badge](https://img.shields.io/docker/pulls/triliumnext/trilium)`,
            `[A link](v0.99.5.md) and <a href="v0.99.5.md">another</a>`
        ].join("\n");

        const { body, images } = rewriteImageSources(note, OPTIONS);

        expect(body).toBe(note);
        expect(images).toEqual([]);
    });

    it("resolves a source against the release notes folder", () => {
        const { body, images } = rewriteImageSources(
            `<img src="./same.png"><img src="../shared/other.png">`, OPTIONS);

        expect(body).toBe([
            `<img src="${BASE}/same.png">`,
            `<img src="https://raw.githubusercontent.com/TriliumNext/Trilium/refs/tags/v0.105.0/docs/Release%20Notes/shared/other.png">`
        ].join(""));
        expect(images).toEqual([
            "docs/Release Notes/Release Notes/same.png",
            "docs/Release Notes/shared/other.png"
        ]);
    });
});
