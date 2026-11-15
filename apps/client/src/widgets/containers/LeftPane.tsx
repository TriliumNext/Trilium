import "./LeftPane.css";

import clsx from "clsx";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "preact/hooks";

import appContext from "../../components/app_context";
import resizer from "../../services/resizer";
import ShowAllNotesButton from "../buttons/show_all_notes_button";
import { useTriliumEvent } from "../react/hooks/events";
import { useLegacyWidget } from "../react/hooks/legacy";
import LazyComponent, { useLazyModule } from "../react/LazyComponent";
import {
    type PaneAction, type PaneModeController, reducePaneMode, usePaneMode, usePeekDismiss
} from "../react/peek_pane";
import { ParentComponent } from "../react/react_utils";

export interface LeftPaneController extends PaneModeController {
    isHorizontalLayout: boolean;
}

/**
 * Owns the mode of the left pane: closed, docked, or peeked over the content. `DesktopLayout` calls
 * it to mark `#horizontal-main-container` while the pane is not docked, and passes it to
 * {@link LeftPane}.
 *
 * @param isHorizontalLayout whether the layout is horizontal, where the peek edge also hides a
 * docked pane. The vertical layout peeks only a hidden pane.
 */
export function useLeftPane(isHorizontalLayout: boolean): LeftPaneController {
    const pane = usePaneMode("leftPaneVisible", "left");
    const parentComponent = useContext(ParentComponent);
    const pendingFocus = useRef<"tree" | "detail" | null>(null);
    const { mode, togglePeek, toggleDocked, dock, close, dismiss } = pane;

    const change = useCallback((action: PaneAction) => {
        const next = reducePaneMode(mode, action);
        if (next === mode) return;

        const hasFocus = document.getElementById("left-pane-host")
            ?.contains(document.activeElement) ?? false;
        if (next !== "closed") {
            pendingFocus.current = "tree";
        } else if (action === "close" || action === "toggleDocked"
            || (action === "togglePeek" && hasFocus)) {
            // A dismissed peek, or one the peek button closes, leaves the focus where it is.
            pendingFocus.current = "detail";
        }
        const actions: Record<PaneAction, () => void> = { togglePeek, toggleDocked, dock, close, dismiss };
        actions[action]();
    }, [ mode, togglePeek, toggleDocked, dock, close, dismiss ]);

    useLayoutEffect(() => {
        const focus = pendingFocus.current;
        pendingFocus.current = null;
        if (focus === "tree") {
            void parentComponent?.triggerEvent("focusTree", {});
        } else if (focus === "detail") {
            const ntxId = appContext.tabManager?.getActiveContext()?.ntxId;
            const noteContainer = document.querySelector(`.note-split[data-ntx-id="${ntxId}"]`);
            if (!noteContainer?.contains(document.activeElement)) {
                void parentComponent?.triggerEvent("focusOnDetail", { ntxId });
            }
        }
    }, [ mode, parentComponent ]);

    useTriliumEvent("setLeftPaneVisibility", useCallback(({ leftPaneVisible }) => {
        change(leftPaneVisible === null ? "toggleDocked" : leftPaneVisible ? "dock" : "close");
    }, [ change ]));
    // `RootCommandExecutor` turns these commands into `setLeftPaneVisibility`; without it, they
    // arrive as events of their own.
    useTriliumEvent("showLeftPane", useCallback(() => change("dock"), [ change ]));
    useTriliumEvent("hideLeftPane", useCallback(() => change("close"), [ change ]));
    useTriliumEvent("toggleLeftPane", useCallback(() => change("toggleDocked"), [ change ]));

    useTriliumEvent("peekLeftPane", useCallback(() => {
        if (isHorizontalLayout || mode !== "docked") {
            change("togglePeek");
        }
    }, [ isHorizontalLayout, mode, change ]));

    usePeekDismiss(mode === "peek", dismiss, {
        keepOpenSelector: "#left-pane, .left-pane-peek-button, .left-pane-toggle-button",
        focusSelector: ".left-pane-peek-button"
    });

    // After the paint, as `resizer` measures `#launcher-pane`, which is not in the page while the
    // layout first renders into a fragment.
    useEffect(() => resizer.setupLeftPaneResizer(mode), [ mode ]);

    return { ...pane, isHorizontalLayout };
}

/**
 * The note tree, with the quick search above it in the vertical layout. The tree is loaded once the
 * pane is first shown, and stays mounted while it is closed again.
 */
export default function LeftPane({ pane }: { pane: LeftPaneController }) {
    const { mode, visible, isHorizontalLayout } = pane;
    const wasShown = useRef(false);
    wasShown.current ||= visible;

    return (
        <div
            id="left-pane-host"
            className={clsx("peek-pane-host side-start", mode === "peek" && "peek", !visible && "hidden-int")}
        >
            <div id="left-pane" className="peek-pane">
                {!isHorizontalLayout && <LazyComponent loader={() => import("../quick_search")} />}
                <ShowAllNotesButton />
                {wasShown.current && <NoteTree />}
            </div>
            <div className="peek-pane-spacer" />
        </div>
    );
}

const loadNoteTree = () => import("../note_tree");

function NoteTree() {
    const noteTree = useLazyModule(loadNoteTree);
    return noteTree ? <LoadedNoteTree NoteTreeWidget={noteTree.default} /> : null;
}

function LoadedNoteTree({ NoteTreeWidget }: { NoteTreeWidget: typeof import("../note_tree").default }) {
    const [ tree ] = useLegacyWidget(() => {
        const widget = new NoteTreeWidget();
        appContext.noteTreeWidget = widget;
        return widget;
    }, { containerClassName: "note-tree-host" });
    return tree;
}
