import { Excalidraw } from "@excalidraw/excalidraw";
import { TypeWidgetProps } from "../type_widget";
import "@excalidraw/excalidraw/index.css";
import { useColorScheme, useEffectiveReadOnly, useTriliumOption } from "../../react/hooks";
import { useCallback, useMemo, useRef } from "preact/hooks";
import { type ExcalidrawImperativeAPI, type AppState } from "@excalidraw/excalidraw/types";
import options from "../../../services/options";
import "./Canvas.css";
import { NonDeleted, NonDeletedExcalidrawElement, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { goToLinkExt } from "../../../services/link";
import useCanvasPersistence from "./persistence";
import useCanvasNoteDrop from "./useCanvasNoteDrop";
import { LANGUAGE_MAPPINGS } from "./i18n";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import tree from "../../../services/tree";
import NoteEmbeddable from "./NoteEmbeddable";

// currently required by excalidraw, in order to allows self-hosting fonts locally.
// this avoids making excalidraw load the fonts from an external CDN.
window.EXCALIDRAW_ASSET_PATH = `${window.location.pathname}/node_modules/@excalidraw/excalidraw/dist/prod`;

export default function Canvas({ note, noteContext }: TypeWidgetProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const colorScheme = useColorScheme();
    const [ locale ] = useTriliumOption("locale");
    const persistence = useCanvasPersistence(note, noteContext, apiRef, colorScheme, isReadOnly);
    const noteDrop = useCanvasNoteDrop(apiRef, isReadOnly);

    /** Use excalidraw's native zoom instead of the global zoom. */
    const onWheel = useCallback((e: MouseEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, []);

    const onLinkOpen = useCallback((element: NonDeletedExcalidrawElement, event: CustomEvent) => {
        let link = element.link;
        if (!link) {
            return false;
        }

        if (link.startsWith("root/")) {
            link = "#" + link;
        }

        const { nativeEvent } = event.detail;
        event.preventDefault();
        return goToLinkExt(nativeEvent, link, null);
    }, []);

    // Allow embeddables that point at a Trilium note (e.g. `root/<noteId>`), which Excalidraw would
    // otherwise reject as an unrecognized provider. Returning `undefined` defers to the default
    // whitelist so normal web embeds keep working.
    const validateEmbeddable = useCallback((link: string) => getNoteIdFromEmbeddableLink(link) ? true : undefined, []);

    // Render the note's content via the shared content renderer instead of the default iframe.
    // Returning `null` falls back to Excalidraw's built-in embeddable rendering.
    const renderEmbeddable = useCallback((element: NonDeleted<ExcalidrawEmbeddableElement>) => {
        const noteId = getNoteIdFromEmbeddableLink(element.link);
        return noteId ? <NoteEmbeddable noteId={noteId} /> : null;
    }, []);

    return (
        <div className="canvas-render" onWheel={onWheel}>
            <div className="excalidraw-wrapper" {...noteDrop}>
                <Excalidraw
                    theme={colorScheme}
                    viewModeEnabled={isReadOnly || options.is("databaseReadonly")}
                    zenModeEnabled={false}
                    isCollaborating={false}
                    detectScroll={false}
                    handleKeyboardGlobally={false}
                    autoFocus={false}
                    langCode={LANGUAGE_MAPPINGS[locale as DISPLAYABLE_LOCALE_IDS] ?? undefined}
                    UIOptions={{
                        canvasActions: {
                            saveToActiveFile: false,
                            export: false
                        }
                    }}
                    onLinkOpen={onLinkOpen}
                    validateEmbeddable={validateEmbeddable}
                    renderEmbeddable={renderEmbeddable}
                    {...persistence}
                />
            </div>
        </div>
    )
}

/**
 * Extracts a Trilium note ID from an embeddable's link, accepting the canonical note-path form
 * (`root/<noteId>` or `#root/<noteId>`). Returns `null` for anything else so non-note embeds are
 * left to Excalidraw's default handling.
 */
function getNoteIdFromEmbeddableLink(link: string | null) {
    if (!link) {
        return null;
    }

    const cleaned = link.replace(/^#/, "");
    if (!cleaned.startsWith("root/")) {
        return null;
    }

    return tree.getNoteIdFromUrl(cleaned);
}
