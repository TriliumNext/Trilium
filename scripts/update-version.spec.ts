import { describe, expect, it } from "vitest";

import { parseReleaseTags, renderMetainfoReleases, selectReleases } from "./update-version";

/** Trimmed to the shape the script anchors on, indentation included. */
const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.triliumnotes.Trilium</id>
  <releases>
    <release version="0.105.0" date="2026-08-19">
      <url type="details">https://github.com/TriliumNext/Trilium/releases/tag/v0.105.0</url>
    </release>
  </releases>
  <provides>
    <id>com.github.zadam.trilium</id>
  </provides>
</component>
`;

describe("parseReleaseTags", () => {
    it("keeps the three-part release tags in the order git gave them", () => {
        const tags = parseReleaseTags([
            "v0.105.0\t2026-08-19",
            "v0.104.1\t2026-07-25",
            "v0.104.0\t2026-07-18"
        ].join("\n"));

        expect(tags).toEqual([
            { version: "0.105.0", date: "2026-08-19" },
            { version: "0.104.1", date: "2026-07-25" },
            { version: "0.104.0", date: "2026-07-18" }
        ]);
    });

    it("drops the tags Flathub never sees and tolerates a trailing newline", () => {
        const tags = parseReleaseTags([
            "v0.105.0\t2026-08-19",
            "v0.92.3-beta\t2025-01-02",
            "v0.91.4-rc1\t2025-01-01",
            "v0.48\t2021-05-01",
            "nightly\t2026-09-01",
            ""
        ].join("\n"));

        expect(tags).toEqual([ { version: "0.105.0", date: "2026-08-19" } ]);
    });
});

describe("selectReleases", () => {
    const TAGS: { version: string; date: string }[] = [
        { version: "0.105.0", date: "2026-08-19" },
        { version: "0.104.1", date: "2026-07-25" },
        { version: "0.104.0", date: "2026-07-18" },
        { version: "0.103.0", date: "2026-05-13" },
        { version: "0.102.2", date: "2026-04-05" },
        { version: "0.102.1", date: "2026-03-08" }
    ];

    it("dates the version being prepared today and keeps the five newest", () => {
        expect(selectReleases(TAGS, "0.106.0", "2026-09-22")).toEqual([
            { version: "0.106.0", date: "2026-09-22" },
            { version: "0.105.0", date: "2026-08-19" },
            { version: "0.104.1", date: "2026-07-25" },
            { version: "0.104.0", date: "2026-07-18" },
            { version: "0.103.0", date: "2026-05-13" }
        ]);
    });

    it("prefers the tag's date once the version has been tagged", () => {
        // A re-run after tagging must not re-date the release to the day of the re-run.
        expect(selectReleases(TAGS, "0.105.0", "2026-09-22")).toEqual(TAGS.slice(0, 5));
    });
});

describe("renderMetainfoReleases", () => {
    it("rewrites the block, keeping the surrounding document and indentation", () => {
        const updated = renderMetainfoReleases(METAINFO, [
            { version: "0.106.0", date: "2026-09-22" },
            { version: "0.105.0", date: "2026-08-19" }
        ]);

        expect(updated).toContain(`  <releases>
    <release version="0.106.0" date="2026-09-22">
      <url type="details">https://github.com/TriliumNext/Trilium/releases/tag/v0.106.0</url>
    </release>
    <release version="0.105.0" date="2026-08-19">
      <url type="details">https://github.com/TriliumNext/Trilium/releases/tag/v0.105.0</url>
    </release>
  </releases>`);
        // The rest of the component is untouched.
        expect(updated).toContain("<id>org.triliumnotes.Trilium</id>");
        expect(updated).toContain("<id>com.github.zadam.trilium</id>");
        expect(updated.endsWith("</component>\n")).toBe(true);
    });

    it("is stable when the list has not changed", () => {
        const releases = [ { version: "0.105.0", date: "2026-08-19" } ];

        expect(renderMetainfoReleases(METAINFO, releases)).toBe(METAINFO);
    });

    it("rejects a metainfo it cannot anchor on", () => {
        expect(() => renderMetainfoReleases("<component></component>", []))
            .toThrow(/releases/);
    });
});
