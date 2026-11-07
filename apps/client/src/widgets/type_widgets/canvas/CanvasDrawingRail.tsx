import "./CanvasDrawingRail.css";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { useFocusWithin, useIsOnScreen, useLingeringTrue } from "../../react/hooks";
import { OverlayControlButton } from "../../react/OverlayControlGroup";
import OverlayRail, { RAIL_EXIT_MS } from "../../react/OverlayRail";
import { type Translate, useExcalidrawTranslation } from "./CanvasEmbedTools";

/** A button of the footer of Excalidraw's phone layout. */
interface FooterAction {
    /** The key of Excalidraw's translation of the button's label and `aria-label`. */
    label: string;
    icon: string;
    isDestructive?: boolean;
}

/** The label of Edit, which opens and closes the properties panel. */
const EDIT_LABEL = "buttons.edit";

/** The footer buttons that the rail shows, in its order. */
export const FOOTER_ACTIONS: readonly FooterAction[] = [
    { label: EDIT_LABEL, icon: "bx-palette" },
    { label: "buttons.done", icon: "bx-check" },
    { label: "labels.duplicateSelection", icon: "bx-duplicate" },
    { label: "labels.delete", icon: "bx-trash", isDestructive: true }
];

/** The class of a footer button that Excalidraw shows. */
export const SHOWN_BUTTON_CLASS = "ToolIcon_type_button--show";
/** The class of a footer button that is pressed, such as Edit while the properties are open. */
export const SELECTED_BUTTON_CLASS = "ToolIcon--selected";

/** A footer button that Excalidraw shows. */
interface ShownAction {
    action: FooterAction;
    isActive: boolean;
}

interface CanvasDrawingRailProps {
    /** The element of the drawing. */
    rootRef: RefObject<HTMLElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
}

/**
 * The buttons of the footer of Excalidraw's phone layout, on a rail at the edge of the screen
 * while the drawing has the focus. `CanvasDrawing.css` hides the footer. Renders inside
 * `<Excalidraw>`, for its translations.
 */
export default function CanvasDrawingRail({ rootRef, apiRef }: CanvasDrawingRailProps) {
    const { t, langCode } = useExcalidrawTranslation();
    const actions = useShownActions(rootRef, apiRef, t, langCode);
    const [ isRailFocused, setIsRailFocused ] = useState(false);
    const isFocused = useFocusWithin(rootRef) || isRailFocused;
    const isOnScreen = useIsOnScreen(rootRef, isFocused);
    const isShown = isFocused && isOnScreen && actions.length > 0;
    const isDrawn = useLingeringTrue(isShown, RAIL_EXIT_MS);
    // Firefox fires no `focusout` at a rail removed with the focus on it.
    useEffect(() => {
        if (!isDrawn) {
            setIsRailFocused(false);
        }
    }, [ isDrawn ]);
    // Keeps the buttons while the rail slides out.
    const drawnActions = useRef(actions);
    if (actions.length) {
        drawnActions.current = actions;
    }

    if (!isDrawn) {
        return null;
    }

    return (
        <OverlayRail
            className="canvas-drawing-rail"
            host={document.body}
            isLeaving={!isShown}
            onFocusIn={() => setIsRailFocused(true)}
            onFocusOut={() => setIsRailFocused(false)}
        >
            {drawnActions.current.map(({ action, isActive }) => (
                <OverlayControlButton
                    key={action.label}
                    title={t(action.label)}
                    icon={action.icon}
                    className={action.isDestructive ? "tn-overlay-rail-destructive" : undefined}
                    active={isActive}
                    onClick={() => findFooterButton(rootRef.current, t(action.label))?.click()}
                />
            ))}
        </OverlayRail>
    );
}

/**
 * The footer buttons that Excalidraw shows, updated as Excalidraw renders them again. Closes the
 * properties panel once Excalidraw hides Edit, so that only Edit opens it again.
 */
function useShownActions(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    t: Translate,
    langCode: string
) {
    const [ actions, setActions ] = useState<ShownAction[]>([]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let key = "";
        const update = () => {
            closeHiddenProperties(root, apiRef.current, t);
            const shown = getShownActions(root, t);
            const shownKey = shown.map(({ action, isActive }) => `${action.label}:${isActive}`)
                .join();
            if (shownKey !== key) {
                key = shownKey;
                setActions(shown);
            }
        };
        const observer = new MutationObserver(update);
        observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [ "class" ]
        });
        update();
        return () => observer.disconnect();
    }, [ rootRef, apiRef, t, langCode ]);

    return actions;
}

/** Closes the properties panel while Excalidraw hides Edit, as when the selection is cleared. */
function closeHiddenProperties(
    root: HTMLElement,
    api: ExcalidrawImperativeAPI | null,
    t: Translate
) {
    const button = findFooterButton(root, t(EDIT_LABEL));
    if (button && !button.classList.contains(SHOWN_BUTTON_CLASS)
        && api?.getAppState().openMenu === "shape") {
        api.updateScene({ appState: { openMenu: null } });
    }
}

function getShownActions(root: HTMLElement, t: Translate) {
    const shown: ShownAction[] = [];
    for (const action of FOOTER_ACTIONS) {
        const button = findFooterButton(root, t(action.label));
        if (button?.classList.contains(SHOWN_BUTTON_CLASS)) {
            shown.push({ action, isActive: button.classList.contains(SELECTED_BUTTON_CLASS) });
        }
    }
    return shown;
}

/** Excalidraw's footer button with the `aria-label` `label`. */
function findFooterButton(root: HTMLElement | null, label: string) {
    const buttons = root?.querySelectorAll<HTMLButtonElement>(".App-toolbar-content > button");
    return [ ...buttons ?? [] ].find((button) => button.getAttribute("aria-label") === label);
}
