import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({ MainMenu: {}, useI18n: vi.fn() }));

const {
    DEFAULT_SIDEBAR, EXTRA_TOOLS, HISTORY_ACTIONS, LOCK, MAIN_TOOLS, MENU_COMMANDS, SEARCH_TAB,
    ZOOM_STEP, ZOOMS
} = await import("./CanvasEmbedTools");
const { MAX_ZOOM, MIN_ZOOM } = await import("./drawing_view");
const { FITTED_MENU_STYLES } = await import("./CanvasDrawing");
const { DRAWING_DARK_FILTER, IMAGE_DARK_FILTER } = await import("./persistence");
const { HISTORY_ICON_PATHS, isInteracting } = await import("./drawing_history");

/** The classes of Trilium that `CanvasDrawing.css` selects. Every other class is Excalidraw's. */
const TRILIUM_CLASSES = new Set([
    "note-detail", "canvas-drawing", "canvas-drawing-editor", "canvas-render",
    "canvas-drawing-picture", "canvas-drawing-view", "theme-dark", "toolbar-over-panel",
    "recentering", "include-note",
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
 * selects, the translations of its toolbar, the zoom and the dark filters it copies. A failure
 * after an upgrade of Excalidraw names the parts to review.
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
            ...[ ...HISTORY_ACTIONS, ...Object.keys(ZOOMS) ].map((id) => `buttons.${id}`),
            ...MENU_COMMANDS.map((command) => command.label)
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

    it("exports in dark colors with the filters that a saved picture applies", () => {
        const compact = (text: string) => text.replace(/\s+/g, "");
        const source = compact(readBundle(developmentDir, [ ".js" ]));

        expect(source).toContain(compact(`var THEME_FILTER = "${DRAWING_DARK_FILTER}";`));
        expect(source).toContain(compact(`var IMAGE_INVERT_FILTER = "${IMAGE_DARK_FILTER}";`));
        expect(source).toContain(compact(
            `if (exportWithDarkMode) { svgRoot.setAttribute("filter", THEME_FILTER); }`));
        expect(source).toContain(compact(`
            const use = svgRoot.ownerDocument.createElementNS(SVG_NS, "use");
            use.setAttribute("href", \`#\${symbolId}\`);
            if (renderConfig.exportWithDarkMode && fileData.mimeType !== MIME_TYPES.svg) {
                use.setAttribute("filter", IMAGE_INVERT_FILTER);
            }`));
        // `saveDrawingPicture()` finds the image that each `<use>` places through its `<symbol>`.
        expect(source).toContain(compact(`
            symbol.id = symbolId;
            const image = svgRoot.ownerDocument.createElementNS(SVG_NS, "image");
            image.setAttribute("href", fileData.dataURL);`));
        expect(source).toContain(compact("symbol.appendChild(image);"));
    });

    it("opens the library and the search in the sidebar that the menus name", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");

        expect(source).toContain(`varDEFAULT_SIDEBAR={name:"${DEFAULT_SIDEBAR}"`);
        expect(source).toContain(`varCANVAS_SEARCH_TAB="${SEARCH_TAB}";`);
    });

    it("shows the keystrokes that Excalidraw binds to the commands of the menu", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");
        // Excalidraw's names of the shortcuts, which its own main menu shows.
        const names: Record<string, string> = {
            exportImage: "imageExport", searchMenu: "searchMenu", help: "toggleShortcuts"
        };

        const missing = MENU_COMMANDS
            .filter((command) => command.keystroke !== undefined)
            .map(({ id, keystroke }) =>
                `${names[id]}:[getShortcutKey("${keystroke?.replace("Ctrl", "CtrlOrCmd")}")]`)
            .filter((shortcut) => !source.includes(shortcut));
        expect(missing).toEqual([]);
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

    it("takes the layout and the view limits from the `UIOptions` of the Trilium patch", () => {
        const hooks = [
            "this.props.UIOptions.getFormFactor?.(", "this.props.UIOptions.constrainView"
        ];
        const unpatched = [ productionDir, developmentDir ].flatMap((dir) => {
            const source = readBundle(dir, [ ".js" ]).replace(/\s+/g, "");
            return hooks.filter((hook) => !source.includes(hook)).map((hook) => `${dir}: ${hook}`);
        });
        expect(unpatched).toEqual([]);
    });

    it("draws the scene and the new element in the layout effects of the Trilium patch", () => {
        // What `StaticCanvas` and `NewElementCanvas` render right after the effect that draws them.
        const markers = [
            /classList\.add\("excalidraw__canvas", ?"static"\)/,
            /className: ?"excalidraw__canvas",\s*style:/
        ];
        const unpatched = [ productionDir, developmentDir ].flatMap((dir) => {
            const source = readBundle(dir, [ ".js" ]);
            const layoutEffects = new Set([ ...source.matchAll(/useLayoutEffect as ([\w$]+)/g) ]
                .map((match) => match[1]));
            return markers.filter((marker) => {
                const at = source.search(marker);
                const start = Math.max(
                    source.lastIndexOf("(()=>{", at), source.lastIndexOf("(() => {", at));
                const hook = source.slice(Math.max(start - 64, 0), start).match(/[\w$]+$/)?.[0];
                return at < 0 || !hook || !layoutEffects.has(hook);
            }).map((marker) => `${dir}: ${marker.source}`);
        });
        expect(unpatched).toEqual([]);
    });

    it("pans and zooms with the wheel through `translateCanvas()`, which the patch limits", () => {
        const source = readBundle(developmentDir, [ ".js" ]);
        const handleWheel = source.split("__publicField(this, \"handleWheel\"")[1]
            ?.split("__publicField(this, ")[0] ?? "";
        expect(handleWheel.match(/this\.translateCanvas\(/g)).toHaveLength(3);
        expect(handleWheel).not.toContain("this.setState(");
    });

    it("lets the undo history of the note replace Excalidraw's undo and redo", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");

        // `registerAction()` replaces the action of the name, which the keys and the buttons run.
        expect(source).toContain(
            "registerAction:(action)=>{this.actionManager.registerAction(action);}");
        expect(source).toContain("registerAction(action){this.actions[action.name]=action;}");
        for (const name of HISTORY_ACTIONS) {
            const create = `create${name[0].toUpperCase()}${name.slice(1)}Action`;
            expect(source).toContain(
                `this.actionManager.registerAction(${create}(this.history,this.store));`);
            expect(source).toContain(`renderAction("${name}")`);
            expect(source).toContain(`d:"${HISTORY_ICON_PATHS[name].replace(/\s+/g, "")}"`);
        }
        // The store ends a change before `onChange`, which records it.
        expect(source).toContain("this.store.commit(elementsMap,this.state);"
            + "if(!this.state.isLoading){this.props.onChange?.(elements,this.state,this.files);");

        // `isInteracting()` holds a change back at least while Excalidraw's undo would wait.
        const guard = source
            .match(/varexecuteHistoryAction=\(app,appState,updater\)=>\{if\((.*?)\)\{/)?.[1];
        const flags = [ ...guard?.matchAll(/!appState\.(\w+)/g) ?? [] ].map((match) => match[1]);
        expect(flags).toHaveLength(6);
        expect(flags.filter((flag) => !isInteracting({ [flag]: true } as never))).toEqual([]);
    });

    it("takes the wheel on its container, after `useNoteScrollingWheel()` on the drawing", () => {
        const source = readBundle(developmentDir, [ ".js" ]).replace(/\s+/g, "");

        expect(source).toContain("addEventListener(this.excalidrawContainerRef.current,"
            + "\"wheel\"/*WHEEL*/,this.handleWheel,{passive:false})");
        expect(source).not.toMatch(/addEventListener\((window|document),"wheel"/);
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
