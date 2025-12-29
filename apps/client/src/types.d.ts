import { IconRegistry } from "@triliumnext/commons";

import appContext, { AppContext } from "./components/app_context";
import type FNote from "./entities/fnote";
import type { PrintReport } from "./print";
import type { lint } from "./services/eslint";
import type { Froca } from "./services/froca-interface";
import { Library } from "./services/library_loader";
import { Suggestion } from "./services/note_autocomplete";
import server from "./services/server";
import utils from "./services/utils";

interface ElectronProcess {
    type: string;
    platform: string;
}

interface CustomGlobals {
    isDesktop: typeof utils.isDesktop;
    isMobile: typeof utils.isMobile;
    device: "mobile" | "desktop" | "print";
    getComponentByEl: typeof appContext.getComponentByEl;
    getHeaders: typeof server.getHeaders;
    getReferenceLinkTitle: (href: string) => Promise<string>;
    getReferenceLinkTitleSync: (href: string) => string;
    getActiveContextNote: () => FNote | null;
    ESLINT: Library;
    appContext: AppContext;
    froca: Froca;
    treeCache: Froca;
    SEARCH_HELP_TEXT: string;
    activeDialog: JQuery<HTMLElement> | null;
    componentId: string;
    csrfToken: string;
    baseApiUrl: string;
    isProtectedSessionAvailable: boolean;
    isDev: boolean;
    isMainWindow: boolean;
    maxEntityChangeIdAtLoad: number;
    maxEntityChangeSyncIdAtLoad: number;
    assetPath: string;
    appPath: string;
    instanceName: string;
    appCssNoteIds: string[];
    triliumVersion: string;
    TRILIUM_SAFE_MODE: boolean;
    platform?: typeof process.platform;
    linter: typeof lint;
    hasNativeTitleBar: boolean;
    isRtl: boolean;
    iconRegistry: IconRegistry;
}

type RequireMethod = (moduleName: string) => any;

declare global {
    interface Window {
        logError(message: string);
        logInfo(message: string);

        process?: ElectronProcess;
        glob?: CustomGlobals;

        /** On the printing endpoint, set to true when the note has fully loaded and is ready to be printed/exported as PDF. */
        _noteReady?: PrintReport;

        EXCALIDRAW_ASSET_PATH?: string;
    }

    interface WindowEventMap {
        "note-ready": Event;
        "note-load-progress": CustomEvent<{ progress: number }>;
    }

    interface AutoCompleteConfig {
        appendTo?: HTMLElement | null;
        hint?: boolean;
        openOnFocus?: boolean;
        minLength?: number;
        tabAutocomplete?: boolean;
        autoselect?: boolean;
        dropdownMenuContainer?: HTMLElement;
        debug?: boolean;
    }

    type AutoCompleteCallback = (values: AutoCompleteArg[]) => void;

    interface AutoCompleteArg {
        name?: string;
        value?: string;
        notePathTitle?: string;
        displayKey?: "name" | "value" | "notePathTitle";
        cache?: boolean;
        source?: (term: string, cb: AutoCompleteCallback) => void,
        templates?: {
            suggestion: (suggestion: Suggestion) => string | undefined
        }
    }

    interface JQuery {
        autocomplete: (action?: "close" | "open" | "destroy" | "val" | AutoCompleteConfig, args?: AutoCompleteArg[] | string) => JQuery<HTMLElement>;

        getSelectedNotePath(): string | undefined;
        getSelectedNoteId(): string | null;
        setSelectedNotePath(notePath: string | null | undefined);
        getSelectedExternalLink(): string | undefined;
        setSelectedExternalLink(externalLink: string | null | undefined);
        setNote(noteId: string);
    }

    var logError: (message: string, e?: Error | string) => void;
    var logInfo: (message: string) => void;
    var glob: CustomGlobals;
    //@ts-ignore
    var require: RequireMethod;
    var __non_webpack_require__: RequireMethod | undefined;

    /*
     * Panzoom
     */

    function panzoom(el: HTMLElement, opts: {
        maxZoom: number,
        minZoom: number,
        smoothScroll: false,
        filterKey: (e: { altKey: boolean }, dx: number, dy: number, dz: number) => void;
    });

    interface PanZoomTransform {
        x: number;
        y: number;
        scale: number;
    }

    interface PanZoom {
        zoomTo(x: number, y: number, scale: number);
        moveTo(x: number, y: number);
        on(event: string, callback: () => void);
        getTransform(): PanZoomTransform;
        dispose(): void;
    }
}
