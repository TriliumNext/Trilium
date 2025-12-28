import { buildNote } from "../test/becca_easy_mocking";
import { determineBestFontAttachment, generateCss, generateIconRegistry, IconPackManifest, processIconPack } from "./icon_packs";

const manifest: IconPackManifest = {
    prefix: "bx",
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
            attachments: [ defaultAttachment ]
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
            prefix: "bx",
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
            ]
        }));
        expect(processedResult).toBeTruthy();
        const css = generateCss(processedResult!);

        console.log(css);
        expect(css).toContain("@font-face");
        expect(css).toContain("font-family: 'trilium-icon-pack-bx'");
        expect(css).toContain(`src: url('/api/attachments/${processedResult?.fontAttachmentId}/download') format('woff2');`);

        expect(css).toContain("@font-face");
        expect(css).toContain("font-family: 'trilium-icon-pack-bx' !important;");
        expect(css).toContain(".bx.bx-ball::before { content: '\\e9c2'; }");
        expect(css).toContain(".bx.bxs-party::before { content: '\\ec92'; }");
    });
});

describe("Icon registery", () => {
    it("generates the registry", () => {
        const iconPack = processIconPack(buildNote({
            title: "Boxicons v2",
            type: "text",
            content: JSON.stringify(manifest),
            attachments: [ defaultAttachment ]
        }));
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

    it("ignores incorrect manifest", () => {
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
            attachments: [ defaultAttachment ]
        }));
        const registry = generateIconRegistry([ iconPack! ]);
        expect(registry.sources).toHaveLength(0);
    });
});
