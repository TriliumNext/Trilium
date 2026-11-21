import { describe, expect, it } from "vitest";

import { parseReleaseTags, releaseDescription, renderMetainfoReleases, selectReleases } from "./update-version";

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

describe("releaseDescription", () => {
    it("takes the overview paragraphs, as AppStream markup", () => {
        const notes = [
            "# v0.108.0",
            "> [!NOTE]",
            "> If you enjoyed this release, consider [donating](https://example.com).",
            "",
            "> [!TIP]",
            "> For Linux users: Trilium is now on Flathub!",
            "",
            "Links can now point at a [heading](https://example.com/1) in **text** and",
            "Markdown notes, with `#anchor` links &amp; _real_ search&nbsp;results.",
            "",
            "Notes <kbd>Ctrl</kbd>+click to open, and snake_case_names stay as they are.",
            "",
            "## 💡 Key highlights",
            "",
            "### Vim mode in text notes",
            "",
            "Not part of the overview."
        ].join("\n");

        expect(releaseDescription(notes)).toEqual([
            { paragraph: "Links can now point at a heading in text and Markdown notes, with "
                + "<code>#anchor</code> links &amp; <em>real</em> search results." },
            { paragraph: "Notes Ctrl+click to open, and snake_case_names stay as they are." }
        ]);
    });

    it("ends with the number of improvements and bug fixes in the note", () => {
        const notes = [
            "# v0.107.0",
            "Text notes became block editors.",
            "",
            "## 💡 Key highlights",
            "### Not counted",
            "*   Not counted either.",
            "## 🔄 Compatibility",
            "*   The sync protocol version went from 39 to 41: instances on different versions "
                + "cannot sync with each other, so update the server and every client together.",
            "    *   [Why it was raised.](https://example.com)",
            "*   The database version went from 240 to 242: the database is migrated the first "
                + "time this version opens it.",
            "*   The Docker image runs as a non-root user.",
            "## 📱 Mobile improvements",
            "*   One",
            "*   Two",
            "## 🐞 Bugfixes",
            "1.  [Sync could lose changes.](https://example.com)",
            "    Details nested under the entry.",
            "<details>",
            "    <summary>Tree (6)</summary>",
            "    <ol><li>…</li></ol>",
            "</details>",
            "<details>",
            "    <summary>Board (3)</summary>",
            "</details>",
            "## ✨ Improvements",
            "<details>",
            "    <summary>Search (1)</summary>",
            "</details>",
            "## 🔒️ Security improvements",
            "*   Not counted."
        ].join("\n");

        expect(releaseDescription(notes)).toEqual([
            { paragraph: "Text notes became block editors." },
            { paragraph: "The sync protocol version went from 39 to 41: instances on different "
                + "versions cannot sync with each other, so update the server and every client together." },
            { paragraph: "The database version went from 240 to 242: the database is migrated the "
                + "first time this version opens it." },
            { paragraph: "Also in this release: 3 improvements and 10 bug fixes." }
        ]);
    });

    it("unwraps an italic lead and skips the collapsible notices around it", () => {
        const notes = [
            "# v0.105.0",
            "_The release that makes Trilium lighter: images shrink themselves._",
            "",
            "<details>",
            "    <summary>🚨 For ARM64 Docker users</summary>",
            "",
            "    services:",
            "</details>",
            "",
            "## 💡 Key highlights"
        ].join("\n");

        expect(releaseDescription(notes)).toEqual([
            { paragraph: "The release that makes Trilium lighter: images shrink themselves." }
        ]);
    });

    it("lists the key highlights when the note has no overview", () => {
        const notes = [
            "# v0.106.0",
            "## 💡 Key highlights",
            "<figure class=\"image\"><img src=\"v0.106.0_image.png\"></figure>",
            "### 📋 Kanban board overhaul by @adoriandoran",
            "The board has been rebuilt.",
            "### Spreadsheets",
            "Text.",
            "### And others…",
            "## 🔄 Compatibility",
            "*   The database version went from 240 to 242: migrated on first start.",
            "## 🐞 Bugfixes",
            "*   Not a highlight"
        ].join("\n");

        expect(releaseDescription(notes)).toEqual([
            { items: [ "Kanban board overhaul", "Spreadsheets",
                "The database version went from 240 to 242: migrated on first start.",
                "Also in this release: 1 bug fix." ] }
        ]);
    });

    it("lists the top-level entries of a patch release", () => {
        const notes = [
            "# v0.106.1",
            "### 🔒 Security",
            "1.  [Updated Node.js](https://example.com) to 24.22.1, taking in its fixes:",
            "    1.  **A nested detail** that stays out.",
            "2.  Signing in no longer fails behind a proxy.",
            "### 🐞 Bugfixes",
            "*   The tree kept a deleted note."
        ].join("\n");

        expect(releaseDescription(notes)).toEqual([ { items: [
            "Updated Node.js to 24.22.1, taking in its fixes.",
            "Signing in no longer fails behind a proxy.",
            "The tree kept a deleted note.",
            "Also in this release: 1 bug fix."
        ] } ]);
    });
});

describe("renderMetainfoReleases", () => {
    it("writes each release's description inside its entry", () => {
        const updated = renderMetainfoReleases(METAINFO, [
            { version: "0.106.0", date: "2026-09-22", description: [
                { paragraph: "Boards &amp; <em>more</em>." },
                { items: [ "Kanban board overhaul", "Spreadsheets" ] }
            ] }
        ]);

        expect(updated).toContain(`  <releases>
    <release version="0.106.0" date="2026-09-22">
      <description>
        <p>Boards &amp; <em>more</em>.</p>
        <ul>
          <li>Kanban board overhaul</li>
          <li>Spreadsheets</li>
        </ul>
      </description>
      <url type="details">https://github.com/TriliumNext/Trilium/releases/tag/v0.106.0</url>
    </release>
  </releases>`);
    });

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

    it("marks a release candidate as a development release", () => {
        const updated = renderMetainfoReleases(METAINFO, [
            { version: "0.108.0-rc.1", date: "2026-11-21" }
        ]);

        expect(updated).toContain(`<release version="0.108.0-rc.1" date="2026-11-21" type="development">`);
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
