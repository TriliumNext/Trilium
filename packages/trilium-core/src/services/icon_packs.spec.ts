import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking";
import { determineBestFontAttachment, generateCss, generateIconRegistry, IconPackManifest, processIconPack } from "./icon_packs";

const manifest: IconPackManifest = {
    icons: {
        "bx-ball": {
            glyph: "\ue9c2",
            terms: [ "ball" ]
        },
        "bxs-party": {
            glyph: "\uec92",
            terms: [ "party" ]
        }
    }
};

const defaultAttachment = {
    role: "file",
    title: "Font",
    mime: "font/woff2"
};

describe("Processing icon packs", () => {
    it("doesn't crash if icon pack is incorrect type", () => {
        const iconPack = processIconPack(buildNote({
            type: "text",
            content: "Foo"
        }));
        expect(iconPack).toBeFalsy();
    });

    it("processes manifest", () => {
        const iconPack = processIconPack(buildNote({
            title: "Boxicons v2",
            type: "text",
            content: JSON.stringify(manifest),
            attachments: [ defaultAttachment ],
            "#iconPack": "bx"
        }));
        expect(iconPack).toBeTruthy();
        expect(iconPack?.manifest).toMatchObject(manifest);
    });
});

describe("Mapping attachments", () => {
    it("handles woff2", () => {
        const iconPackNote = buildNote({
            type: "text",
            attachments: [ defaultAttachment ]
        });
        const attachment = determineBestFontAttachment(iconPackNote);
        expect(attachment?.mime).toStrictEqual("font/woff2");
    });

    it("handles woff", () => {
        const iconPackNote = buildNote({
            type: "text",
            attachments: [
                {
                    role: "file",
                    title: "Font",
                    mime: "font/woff"
                }
            ]
        });
        const attachment = determineBestFontAttachment(iconPackNote);
        expect(attachment?.mime).toStrictEqual("font/woff");
    });

    it("handles ttf", () => {
        const iconPackNote = buildNote({
            type: "text",
            attachments: [
                {
                    role: "file",
                    title: "Font",
                    mime: "font/ttf"
                }
            ]
        });
        const attachment = determineBestFontAttachment(iconPackNote);
        expect(attachment?.mime).toStrictEqual("font/ttf");
    });

    it("ignores when no right attachment is found", () => {
        const iconPackNote = buildNote({
            type: "text",
            attachments: [
                {
                    role: "file",
                    title: "Font",
                    mime: "font/otf"
                }
            ]
        });
        const attachment = determineBestFontAttachment(iconPackNote);
        expect(attachment).toBeNull();
    });

    it("prefers woff2", () => {
        const iconPackNote = buildNote({
            type: "text",
            attachments: [
                {
                    role: "file",
                    title: "Font",
                    mime: "font/woff"
                },
                {
                    role: "file",
                    title: "Font",
                    mime: "font/ttf"
                },
                {
                    role: "file",
                    title: "Font",
                    mime: "font/woff2"
                }
            ]
        });
        const attachment = determineBestFontAttachment(iconPackNote);
        expect(attachment?.mime).toStrictEqual("font/woff2");
    });
});

describe("CSS generation", () => {
    it("generates the CSS", () => {
        const manifest: IconPackManifest = {
            icons: {
                "bx-ball": {
                    "glyph": "\ue9c2",
                    "terms": [ "ball" ]
                },
                "bxs-party": {
                    "glyph": "\uec92",
                    "terms": [ "party" ]
                }
            }
        };
        const processedResult = processIconPack(buildNote({
            type: "text",
            title: "Boxicons v2",
            content: JSON.stringify(manifest),
            attachments: [
                {
                    role: "file",
                    title: "Font",
                    mime: "font/woff2"
                }
            ],
            "#iconPack": "bx"
        }));
        expect(processedResult).toBeTruthy();
        const css = generateCss(processedResult!, `/api/attachments/${processedResult?.fontAttachmentId}/download`);

        expect(css).toContain("@font-face");
        expect(css).toContain("font-family: 'trilium-icon-pack-bx'");
        expect(css).toContain(`src: url('/api/attachments/${processedResult?.fontAttachmentId}/download') format('woff2');`);

        expect(css).toContain("@font-face");
        expect(css).toContain("font-family: 'trilium-icon-pack-bx' !important;");
        expect(css).toContain(`.bx.bx-ball::before { content: "\ue9c2"; }`);
        expect(css).toContain(`.bx.bxs-party::before { content: "\uec92"; }`);
    });
});

describe("Generating CSS for untrusted manifests", () => {
    function generateCssFor(icons: IconPackManifest["icons"]) {
        const processedResult = processIconPack(buildNote({
            type: "text",
            title: "Untrusted pack",
            content: JSON.stringify({ icons }),
            attachments: [ defaultAttachment ],
            "#iconPack": "un"
        }));
        expect(processedResult).toBeTruthy();
        return generateCss(processedResult!, "/api/attachments/x/download");
    }

    it("drops icon keys outside the CSS class charset and keeps the valid ones", () => {
        const css = generateCssFor({
            "un-ok": { glyph: "\ue9c2", terms: [ "ok" ] },
            "un-evil</style><script>alert(1)</script>": { glyph: "\uec92", terms: [ "evil" ] },
            "un evil": { glyph: "\uec92", terms: [ "evil" ] }
        });

        expect(css).toContain(`.un.un-ok::before { content: "\ue9c2"; }`);
        expect(css).not.toContain("<script>");
        expect(css).not.toContain(".un.un evil");
    });

    it("keeps non-ASCII icon keys, which are valid CSS class names", () => {
        const css = generateCssFor({
            "un-caf\u00e9": { glyph: "\ue9c2", terms: [ "coffee" ] },
            "un-\u56fe\u6807": { glyph: "\ue9c3", terms: [ "icon" ] }
        });

        expect(css).toContain(`.un.un-caf\u00e9::before { content: "\ue9c2"; }`);
        expect(css).toContain(`.un.un-\u56fe\u6807::before { content: "\ue9c3"; }`);
    });

    it("keeps emoji glyphs and keys, whose surrogate pairs sit above U+0080", () => {
        const css = generateCssFor({
            "utf-grinning-face": { glyph: "\u{1F600}", terms: [ "grinning face" ] },
            "utf-\u{1F600}": { glyph: "\u{1F600}", terms: [ "grinning face" ] }
        });

        expect(css).toContain(`.un.utf-grinning-face::before { content: "\u{1F600}"; }`);
        expect(css).toContain(`.un.utf-\u{1F600}::before { content: "\u{1F600}"; }`);
    });

    it("escapes a glyph so it cannot end the style element it is served in", () => {
        const css = generateCssFor({
            "un-evil": { glyph: `</style><script>alert(1)</script>`, terms: [ "evil" ] }
        });

        expect(css).not.toMatch(/<\/style/i);
        expect(css).toContain(`.un.un-evil::before { content: "\\3c /style\\3e \\3c script\\3e alert(1)\\3c /script\\3e "; }`);
    });

    it("escapes a glyph so it cannot break out of the content declaration", () => {
        const css = generateCssFor({
            "un-evil": { glyph: `"; } body { display: none; } .x::before { content: "`, terms: [ "evil" ] }
        });

        // Both quotes are escaped, so the payload stays a CSS string value: it renders as
        // text rather than closing `content` and opening a rule of the attacker's choosing.
        expect(css).toContain(`.un.un-evil::before { content: "\\22 ; } body { display: none; } .x::before { content: \\22 "; }`);
    });
});

describe("Icon registry", () => {
    it("generates the registry", () => {
        const iconPack = processIconPack(buildNote({
            title: "Boxicons v2",
            type: "text",
            content: JSON.stringify(manifest),
            attachments: [ defaultAttachment ],
            "#iconPack": "bx"
        }));
        expect(iconPack).toBeTruthy();
        const registry = generateIconRegistry([ iconPack! ]);
        expect(registry.sources).toHaveLength(1);
        expect(registry.sources[0]).toMatchObject({
            name: "Boxicons v2",
            prefix: "bx",
            icons: [
                {
                    id: "bx bx-ball",
                    terms: [ "ball" ]
                },
                {
                    id: "bx bxs-party",
                    terms: [ "party" ]
                }
            ]
        });
    });

    it("ignores manifest with wrong icon structure", () => {
        const iconPack = processIconPack(buildNote({
            type: "text",
            content: JSON.stringify({
                name: "Boxicons v2",
                prefix: "bx",
                icons: {
                    "bx-ball": "\ue9c2",
                    "bxs-party": "\uec92"
                }
            }),
            attachments: [ defaultAttachment ],
            "#iconPack": "bx"
        }));
        expect(iconPack).toBeTruthy();
        const registry = generateIconRegistry([ iconPack! ]);
        expect(registry.sources).toHaveLength(0);
    });

    it("ignores manifest with corrupt JSON", () => {
        const iconPack = processIconPack(buildNote({
            type: "text",
            content: "{ this is not valid JSON }",
            attachments: [ defaultAttachment ],
            "#iconPack": "bx"
        }));
        expect(iconPack).toBeFalsy();
    });
});
