import "./MobileSidebar.css";

import clsx from "clsx";
import type { RefObject } from "preact";
import { useContext, useLayoutEffect, useRef, useState } from "preact/hooks";

import options from "../../services/options";
import { STACKED_TREE_LAYOUT } from "../../services/utils";
import LazyQuickSearch from "../LazyQuickSearch";
import { useMediaQuery } from "../react/hooks/dom";
import { useTriliumEvent } from "../react/hooks/events";
import { useLazyModule } from "../react/LazyComponent";
import { ParentComponent } from "../react/react_utils";
import SidebarNavigation from "./sidebar_container";

/**
 * The note tree of the mobile layout: the quick search above the note navigator. The sidebar itself
 * renders with the layout, to follow the tabs as they are restored; the navigator loads after the
 * first paint. On a tablet it hides like the left pane on desktop, sharing its option, from the
 * `LeftPaneToggle` of the launch bar, and a gutter after it resizes it, to a width of its own
 * (`mobileLeftPaneWidth`, in pixels, which suits either orientation).
 */
export default function MobileSidebar() {
    const sidebarRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<SidebarNavigation | null>(null);
    const parentComponent = useContext(ParentComponent);
    const [ leftPaneVisible, setLeftPaneVisible ] = useState(() => options.is("leftPaneVisible"));
    const isTreeStacked = useMediaQuery(STACKED_TREE_LAYOUT);
    const [ width, setWidth ] = useState(() => options.getInt("mobileLeftPaneWidth") ?? 0);

    useLayoutEffect(() => {
        const sidebar = sidebarRef.current;
        if (!sidebar) return;
        if (width > 0) {
            sidebar.style.setProperty("--mobile-sidebar-width", `${width}px`);
        } else {
            sidebar.style.removeProperty("--mobile-sidebar-width");
        }
    }, [ width ]);

    useLayoutEffect(() => {
        const sidebar = sidebarRef.current;
        if (!sidebar) return;
        const navigation = new SidebarNavigation(sidebar, (screen) => {
            void parentComponent?.triggerCommand("setActiveScreen", { screen });
        });
        navigationRef.current = navigation;
        return () => navigation.dispose();
    }, [ parentComponent ]);

    useTriliumEvent("setLeftPaneVisibility", ({ leftPaneVisible: requested }) => {
        const visible = requested ?? !leftPaneVisible;
        if (visible === leftPaneVisible) return;
        setLeftPaneVisible(visible);
        void options.save("leftPaneVisible", visible.toString());
        // The launch bar's `LeftPaneToggle` follows the sidebar as it follows the left pane on desktop.
        void parentComponent?.triggerEvent("paneModeChanged", { pane: "left", mode: visible ? "docked" : "closed" });
    });
    useTriliumEvent("activeContextChanged", ({ noteContext }) => navigationRef.current?.switchToTab(noteContext));
    useTriliumEvent("noteSwitchedAndActivated", ({ noteContext }) => navigationRef.current?.switchToTab(noteContext));
    useTriliumEvent("noteSwitched", ({ noteContext, notePath }) => navigationRef.current?.noteSwitched(noteContext, notePath));
    useTriliumEvent("noteContextRemoved", ({ ntxIds }) => navigationRef.current?.noteContextsRemoved(ntxIds));
    useTriliumEvent("activeScreenChanged", ({ activeScreen }) => navigationRef.current?.activeScreenChanged(activeScreen));

    return (
        <>
            <div ref={sidebarRef} id="mobile-sidebar-wrapper" className={clsx(!leftPaneVisible && "left-pane-hidden")}>
                <div className="mobile-sidebar-content">
                    <LazyQuickSearch />
                    <LazyNoteNavigator />
                </div>
            </div>
            {!isTreeStacked && leftPaneVisible && (
                <SidebarGutter
                    sidebarRef={sidebarRef}
                    onResized={(newWidth) => {
                        setWidth(newWidth);
                        void options.save("mobileLeftPaneWidth", newWidth);
                    }}
                />
            )}
        </>
    );
}

/**
 * The gutter after the docked tree, which a drag resizes. While dragging, the tree follows the
 * pointer through `--mobile-sidebar-width`; on release, `onResized` gets the width the stylesheet
 * let the tree take.
 */
function SidebarGutter({ sidebarRef, onResized }: {
    sidebarRef: RefObject<HTMLDivElement | null>;
    onResized: (width: number) => void;
}) {
    function startDrag(e: PointerEvent) {
        const sidebar = sidebarRef.current;
        const gutter = e.currentTarget;
        if (!sidebar || !(gutter instanceof HTMLElement)) return;

        e.preventDefault();
        gutter.setPointerCapture(e.pointerId);
        gutter.classList.add("dragging");
        const { left, right } = sidebar.getBoundingClientRect();
        let hasMoved = false;

        const move = (ev: PointerEvent) => {
            hasMoved = true;
            const width = glob.isRtl ? right - ev.clientX : ev.clientX - left;
            sidebar.style.setProperty("--mobile-sidebar-width", `${Math.round(width)}px`);
        };
        const end = () => {
            gutter.removeEventListener("pointermove", move);
            gutter.removeEventListener("pointerup", end);
            gutter.removeEventListener("pointercancel", end);
            gutter.classList.remove("dragging");
            if (hasMoved) onResized(Math.round(sidebar.getBoundingClientRect().width));
        };
        gutter.addEventListener("pointermove", move);
        gutter.addEventListener("pointerup", end);
        gutter.addEventListener("pointercancel", end);
    }

    return <div className="mobile-sidebar-gutter gutter gutter-horizontal" onPointerDown={startDrag} />;
}

const loadNoteNavigator = () => import("./MobileNoteNavigator");

function LazyNoteNavigator() {
    const noteNavigator = useLazyModule(loadNoteNavigator);
    return noteNavigator ? <noteNavigator.default /> : null;
}
