import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({ MainMenu: {}, useI18n: vi.fn() }));

const {
    EXTRA_TOOLS, HISTORY_ACTIONS, LOCK, MAIN_TOOLS, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, ZOOMS
} = await import("./CanvasEmbedTools");
const { LIBRARY_SIDEBAR } = await import("./CanvasDrawingMenu");
const { FITTED_MENU_STYLES } = await import("./CanvasDrawing");

/** The classes of Trilium that `CanvasDrawing.css` selects. Every other class is Excalidraw's. */
const TRILIUM_CLASSES = new Set([
    "note-detail", "canvas-drawing", "canvas-drawing-editor", "canvas-render",
    "canvas-drawing-picture", "toolbar-over-panel", "recentering", "include-note",
    "include-note-body",
    "include-note-content", "active", "tn-icon"
]);

/** The classes of Excalidraw that `CanvasDrawing.tsx` and `CanvasEmbedTools.tsx` look up. */
const CODE_CLASSES = [
    "excalidraw", "excalidraw-container", "App-menu__left", "App-toolbar-container",
    "context-menu", "popover"
];

/**
 * Checks what the canvas drawing relies on beyond Excalidraw's API: the classes and test ids it
 * selects, the translations of its toolbar, and the zoom it copies. A failure after an upgrade of
 * Excalidraw names the parts to review.
 */
describe("Excalidraw contract of the canvas drawing", () => {
    // Vitest resolves the `development` export, so both folders come from `dist`.
    const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
    const distDir = join(dirname(entry), "..");
    const productionDir = join(distDir, "prod");
    // The minified bundle renames the objects of the translations and the zoom constants.
    const developmentDir = join(distDir, "dev");

    it("renders every class and test id that the drawing selects", () => {
        const bundle = readBundle(productionDir, [ ".js", ".css" ]);
        // Vitest gives an empty string for a stylesheet imported with `?raw`.
        const styles = readFileSync(join(__dirname, "CanvasDrawing.css"), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "");
        const classes = [ ...styles.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g) ]
            .map((match) => match[1])
            .filter((name) => !TRILIUM_CLASSES.has(name));
        const testIds = [ ...styles.matchAll(/data-testid="([^"]+)"/g) ].map((match) => match[1]);
        const names = new Set([
            ...classes,
            ...CODE_CLASSES,
            ...testIds,
            ...HISTORY_ACTIONS.map((id) => `button-${id}`)
        ]);

        const missing = [ ...names ]
            .filter((name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(bundle));
        expect(missing, "Gone from Excalidraw, or a Trilium class missing in TRILIUM_CLASSES")
            .toEqual([]);
    });

    it("names every button of the toolbar with Excalidraw's own translations", () => {
        const source = readBundle(developmentDir, [ ".js" ]);
        const keys = [
            ...[ ...MAIN_TOOLS, ...EXTRA_TOOLS, LOCK, "extraTools" ].map((id) => `toolBar.${id}`),
            ...[ ...HISTORY_ACTIONS, ...Object.keys(ZOOMS) ].map((id) => `buttons.${id}`)
        ];

        const missing = keys.filter((key) => {
            const [ section, name ] = key.split(".");
            return !getEnglishKeys(source, section).has(name);
        });
        expect(missing).toEqual([]);
    });

    it("zooms with the step, the limits and the math that the toolbar copies", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");

        expect(source).toContain(`varZOOM_STEP=${ZOOM_STEP};`);
        expect(source).toContain(`varMIN_ZOOM=${MIN_ZOOM};`);
        expect(source).toContain(`varMAX_ZOOM=${MAX_ZOOM};`);
        // `getZoomState()` keeps the center of the view in place, as `getStateForZoom()` does.
        expect(source).toContain("viewportX:appState.width/2+appState.offsetLeft");
        expect(source).toContain("baseScrollX=appState.scrollX+(appLayerX-appLayerX/currentZoom)");
        expect(source).toContain("zoomOffsetScrollX=-(appLayerX-appLayerX/nextZoom)");
    });

    it("opens the library in the sidebar that the main menu names", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");

        expect(source).toContain(`varDEFAULT_SIDEBAR={name:"${LIBRARY_SIDEBAR}"`);
    });

    it("fits the context menu in its container with the styles that the top layer replaces", () => {
        const source = readBundle(developmentDir, [ ".js" ]);
        const popover = source.split("// components/Popover.tsx")[1]
            ?.split("// components/ContextMenu.tsx")[0] ?? "";
        const styles = [ ...popover.matchAll(/container\.style\.(\w+) =/g) ]
            .map((match) => match[1]);
        expect(new Set(styles)).toEqual(new Set(FITTED_MENU_STYLES));

        // `useTopLayerContextMenu()` adds the position of the container to the point of the menu.
        expect(source.replace(/\s+/g, "")).toContain([
            "constcontainer=this.excalidrawContainerRef.current;",
            "const{top:offsetTop,left:offsetLeft}=container.getBoundingClientRect();",
            "constleft=event.clientX-offsetLeft;consttop=event.clientY-offsetTop;"
        ].join(""));
    });

    it("takes the layout from `UIOptions.getFormFactor`, which the Trilium patch adds", () => {
        const unpatched = [ productionDir, developmentDir ].filter((dir) => {
            const source = readBundle(dir, [ ".js" ]).replace(/\s+/g, "");
            return !source.includes("this.props.UIOptions.getFormFactor?.(");
        });
        expect(unpatched).toEqual([]);
    });
});

/** The text of the scripts or stylesheets in `dir`, without its locales and fonts. */
function readBundle(dir: string, extensions: string[]) {
    return readdirSync(dir)
        .filter((file) => extensions.some((extension) => file.endsWith(extension)))
        .map((file) => readFileSync(join(dir, file), "utf8"))
        .join("\n");
}

/** The keys of the English translations in `section`, such as `toolBar`. */
function getEnglishKeys(source: string, section: string) {
    const body = source.match(new RegExp(`\\nvar ${section} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
    return new Set([ ...body.matchAll(/^\s+(\w+):/gm) ].map((match) => match[1]));
}
