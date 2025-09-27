import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useNoteContext } from "../../react/hooks";
import "./mobile_editor_toolbar.css";
import { isIOS } from "../../../services/utils";

/**
 * Handles the editing toolbar for CKEditor in mobile mode. The toolbar acts as a floating bar, with two different mechanism:
 *
 * - On iOS, because it does not respect the viewport meta value `interactive-widget=resizes-content`, we need to listen to window resizes and scroll and reposition the toolbar using absolute positioning.
 * - On Android, the viewport change makes the keyboard resize the content area, all we have to do is to hide the tab bar and global menu (handled in the global style).
 */
export default function MobileEditorToolbar() {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { note, noteContext } = useNoteContext();
    const [ shouldDisplay, setShouldDisplay ] = useState(false);
    const [ dropdownActive, setDropdownActive ] = useState(false);

    usePositioningOniOS(wrapperRef);

    useEffect(() => {
        noteContext?.isReadOnly().then(isReadOnly => {
            setShouldDisplay(note?.type === "text" && !isReadOnly);
        });
    }, [ note ]);

    // Observe when a dropdown is expanded to apply a style that allows the dropdown to be visible, since we can't have the element both visible and the toolbar scrollable.
    useEffect(() => {
        if (!wrapperRef.current) return;

        const observer = new MutationObserver(e => {
            setDropdownActive(e.map((e) => (e.target as any).ariaExpanded === "true").reduce((acc, e) => acc && e));
        });

        observer.observe(wrapperRef.current, {
            attributeFilter: ["aria-expanded"],
            subtree: true
        });

        return () => observer.disconnect();
    }, []);

    return (
        <div className={`classic-toolbar-outer-container ${!shouldDisplay ? "hidden-ext" : "visible"} ${isIOS() ? "ios" : ""}`}>
            <div ref={wrapperRef} className={`classic-toolbar-widget ${dropdownActive ? "dropdown-active" : ""}`}></div>
        </div>
    )
}

function usePositioningOniOS(wrapperRef: MutableRef<HTMLDivElement | null>) {
    const adjustPosition = useCallback(() => {
        if (!wrapperRef.current) return;
        let bottom = window.innerHeight - (window.visualViewport?.height || 0);
        wrapperRef.current.style.bottom = `${bottom}px`; 
    }, []);

    useEffect(() => {
        if (!isIOS()) return;

        window.visualViewport?.addEventListener("resize", adjustPosition);
        window.addEventListener("scroll", adjustPosition);

        return () => {
            window.visualViewport?.removeEventListener("resize", adjustPosition);
            window.removeEventListener("scroll", adjustPosition);
        };
    }, []);
}
