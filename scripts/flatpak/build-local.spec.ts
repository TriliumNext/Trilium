import { describe, expect, it } from "vitest";

import { parseIgnoredPaths, useLocalDirSource, useTestAppId } from "./build-local.mjs";

const SOURCES = (pin: string) => `\
    sources:
      - type: git
        url: https://github.com/TriliumNext/Trilium.git
${pin}      - generated-sources.json
      - type: archive
        url: https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.0.0.tgz
`;

describe("useLocalDirSource", () => {
    it("swaps a pinned git source for a dir source and keeps the others", () => {
        const expected = `\
    sources:
      - type: dir
        path: "/home/user/Trilium"
        skip:
          - "node_modules"
          - "apps/client/dist"
      - generated-sources.json
      - type: archive
        url: https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.0.0.tgz
`;
        const skip = [ "node_modules", "apps/client/dist" ];
        const commit = "        commit: 1234567890abcdef1234567890abcdef12345678\n";
        const tagged = `        tag: v0.106.0\n${commit}`;
        for (const pin of [ commit, tagged ]) {
            expect(useLocalDirSource(SOURCES(pin), "/home/user/Trilium", skip)).toBe(expected);
        }
    });

    it("fails on a manifest without the Trilium git source", () => {
        expect(() => useLocalDirSource("sources: []\n", "/repo", []))
            .toThrow(/no Trilium git source/);
    });
});

describe("useTestAppId", () => {
    it("renames the app and builds its exports from the release's files", () => {
        const manifest = `\
app-id: org.triliumnotes.Trilium
runtime: org.freedesktop.Platform
modules:
  - name: trilium
    build-commands:
      - install -Dm644 apps/desktop/flatpak/\${FLATPAK_ID}.desktop /app/share/applications/\${FLATPAK_ID}.desktop
      - install -Dm644 apps/desktop/flatpak/\${FLATPAK_ID}.metainfo.xml /app/share/metainfo/\${FLATPAK_ID}.metainfo.xml
`;
        expect(useTestAppId(manifest)).toBe(`\
app-id: org.triliumnotes.Trilium.Test
rename-desktop-file: org.triliumnotes.Trilium.desktop
rename-appdata-file: org.triliumnotes.Trilium.metainfo.xml
rename-icon: org.triliumnotes.Trilium
desktop-file-name-suffix: " (Test)"
runtime: org.freedesktop.Platform
modules:
  - name: trilium
    build-commands:
      - install -Dm644 apps/desktop/flatpak/org.triliumnotes.Trilium.desktop /app/share/applications/org.triliumnotes.Trilium.desktop
      - install -Dm644 apps/desktop/flatpak/org.triliumnotes.Trilium.metainfo.xml /app/share/metainfo/org.triliumnotes.Trilium.metainfo.xml
`);
    });

    it("fails on a manifest for another app", () => {
        expect(() => useTestAppId("app-id: org.example.App\n")).toThrow(/app-id/);
    });
});

describe("parseIgnoredPaths", () => {
    it("keeps each NUL-separated path exactly, minus directory slashes and nested paths", () => {
        const output = [
            ".flatpak-builder/", ".flatpak-builder/ccache/", "apps/client/dist/",
            " notes with spaces .md", "Ünïcode \"quoted\"/", "node_modules/", "node_modules_backup/", ""
        ].join("\0");
        expect(parseIgnoredPaths(output)).toEqual([
            ".flatpak-builder", "apps/client/dist", " notes with spaces .md", "Ünïcode \"quoted\"",
            "node_modules", "node_modules_backup"
        ]);
    });
});
