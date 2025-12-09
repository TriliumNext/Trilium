import { Excalidraw } from "@excalidraw/excalidraw";
import { TypeWidgetProps } from "../type_widget";
import "@excalidraw/excalidraw/index.css";
import { useNoteLabelBoolean, useTriliumOption } from "../../react/hooks";
import { useCallback, useMemo, useRef } from "preact/hooks";
import { type ExcalidrawImperativeAPI, type AppState } from "@excalidraw/excalidraw/types";
import options from "../../../services/options";
import "./Canvas.css";
import { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { goToLinkExt } from "../../../services/link";
import useCanvasPersistence from "./persistence";
import { LANGUAGE_MAPPINGS } from "./i18n";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";

// currently required by excalidraw, in order to allows self-hosting fonts locally.
// this avoids making excalidraw load the fonts from an external CDN.
window.EXCALIDRAW_ASSET_PATH = `${window.location.pathname}/node_modules/@excalidraw/excalidraw/dist/prod`;

export default function Canvas({ note, noteContext }: TypeWidgetProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const themeStyle = useMemo(() => {
        const documentStyle = window.getComputedStyle(document.documentElement);
        return documentStyle.getPropertyValue("--theme-style")?.trim() as AppState["theme"];
    }, []);
    const [ locale ] = useTriliumOption("locale");
    const persistence = useCanvasPersistence(note, noteContext, apiRef, themeStyle, isReadOnly);

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

    return (
        <div className="canvas-render" onWheel={onWheel}>
            <div className="excalidraw-wrapper">
                <Excalidraw
                    excalidrawAPI={api => apiRef.current = api}
                    theme={themeStyle}
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
                    {...persistence}
                />
            </div>
        </div>
    )
}
