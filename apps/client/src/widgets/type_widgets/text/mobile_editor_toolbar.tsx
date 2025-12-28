import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useNoteContext, useTriliumEvent } from "../../react/hooks";
import "./mobile_editor_toolbar.css";
import { isIOS } from "../../../services/utils";
import { CKTextEditor, ClassicEditor } from "@triliumnext/ckeditor5";

interface MobileEditorToolbarProps {
    inPopupEditor?: boolean;
}

/**
 * Handles the editing toolbar for CKEditor in mobile mode. The toolbar acts as a floating bar, with two different mechanism:
 *
 * - On iOS, because it does not respect the viewport meta value `interactive-widget=resizes-content`, we need to listen to window resizes and scroll and reposition the toolbar using absolute positioning.
 * - On Android, the viewport change makes the keyboard resize the content area, all we have to do is to hide the tab bar and global menu (handled in the global style).
 */
export default function MobileEditorToolbar({ inPopupEditor }: MobileEditorToolbarProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { note, noteContext, ntxId } = useNoteContext();
    const [ shouldDisplay, setShouldDisplay ] = useState(false);
    const [ dropdownActive, setDropdownActive ] = useState(false);

    usePositioningOniOS(!inPopupEditor, containerRef);

    useEffect(() => {
        noteContext?.isReadOnly().then(isReadOnly => {
            setShouldDisplay(note?.type === "text" && !isReadOnly);
        });
    }, [ note ]);

    // Attach the toolbar from the CKEditor.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (eventNtxId !== ntxId || !containerRef.current) return;
        const toolbar = editor.ui.view.toolbar?.element;

        if (!inPopupEditor) {
            repositionDropdowns(editor);
        }

        if (toolbar) {
            containerRef.current.replaceChildren(toolbar);
        } else {
            containerRef.current.replaceChildren();
        }
    });

    // Observe when a dropdown is expanded to apply a style that allows the dropdown to be visible, since we can't have the element both visible and the toolbar scrollable.
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new MutationObserver(e => {
            setDropdownActive(e.map((e) => (e.target as any).ariaExpanded === "true").reduce((acc, e) => acc && e));
        });

        observer.observe(containerRef.current, {
            attributeFilter: ["aria-expanded"],
            subtree: true
        });

        return () => observer.disconnect();
    }, []);

    return (
        <div className={`classic-toolbar-outer-container ${!shouldDisplay ? "hidden-ext" : "visible"} ${isIOS() ? "ios" : ""}`}>
            <div ref={containerRef} className={`classic-toolbar-widget ${dropdownActive ? "dropdown-active" : ""}`}></div>
        </div>
    )
}

function usePositioningOniOS(enabled: boolean, wrapperRef: MutableRef<HTMLDivElement | null>) {
    const adjustPosition = useCallback(() => {
        if (!wrapperRef.current) return;
        let bottom = window.innerHeight - (window.visualViewport?.height || 0);
        wrapperRef.current.style.bottom = `${bottom}px`;
    }, []);

    useEffect(() => {
        if (!isIOS() || !enabled) return;

        window.visualViewport?.addEventListener("resize", adjustPosition);
        window.addEventListener("scroll", adjustPosition);

        return () => {
            window.visualViewport?.removeEventListener("resize", adjustPosition);
            window.removeEventListener("scroll", adjustPosition);
        };
    }, [ enabled ]);
}

/**
 * Reposition all dropdowns to point upwards instead of downwards.
 * See https://ckeditor.com/docs/ckeditor5/latest/examples/framework/bottom-toolbar-editor.html for more info.
 * @param editor
 */
function repositionDropdowns(editor: CKTextEditor) {
    const toolbarView = (editor as ClassicEditor).ui.view.toolbar;
    for (const item of toolbarView.items) {
        if (!("panelView" in item)) continue;

        item.on("change:isOpen", () => {
            if (!("isOpen" in item) || !item.isOpen) return;

            // @ts-ignore
            item.panelView.position = item.panelView.position.replace("s", "n");
        });
    }
}
