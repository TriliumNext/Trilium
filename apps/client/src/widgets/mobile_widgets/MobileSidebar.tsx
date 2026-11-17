import "./MobileSidebar.css";

import clsx from "clsx";
import { useContext, useLayoutEffect, useRef, useState } from "preact/hooks";

import options from "../../services/options";
import LazyQuickSearch from "../LazyQuickSearch";
import { useTriliumEvent } from "../react/hooks/events";
import { useLazyModule } from "../react/LazyComponent";
import { ParentComponent } from "../react/react_utils";
import SidebarNavigation from "./sidebar_container";

/**
 * The note tree of the mobile layout: the quick search above the note navigator. The sidebar itself
 * renders with the layout, to follow the tabs as they are restored; the navigator loads after the
 * first paint. On a tablet it hides like the left pane on desktop, sharing its option.
 */
export default function MobileSidebar() {
    const sidebarRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<SidebarNavigation | null>(null);
    const parentComponent = useContext(ParentComponent);
    const [ leftPaneVisible, setLeftPaneVisible ] = useState(() => options.is("leftPaneVisible"));

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
    });
    useTriliumEvent("activeContextChanged", ({ noteContext }) => navigationRef.current?.switchToTab(noteContext));
    useTriliumEvent("noteSwitchedAndActivated", ({ noteContext }) => navigationRef.current?.switchToTab(noteContext));
    useTriliumEvent("noteSwitched", ({ noteContext, notePath }) => navigationRef.current?.noteSwitched(noteContext, notePath));
    useTriliumEvent("noteContextRemoved", ({ ntxIds }) => navigationRef.current?.noteContextsRemoved(ntxIds));
    useTriliumEvent("activeScreenChanged", ({ activeScreen }) => navigationRef.current?.activeScreenChanged(activeScreen));

    return (
        <div ref={sidebarRef} id="mobile-sidebar-wrapper" className={clsx(!leftPaneVisible && "left-pane-hidden")}>
            <div className="mobile-sidebar-content">
                <LazyQuickSearch />
                <LazyNoteNavigator />
            </div>
        </div>
    );
}

const loadNoteNavigator = () => import("./MobileNoteNavigator");

function LazyNoteNavigator() {
    const noteNavigator = useLazyModule(loadNoteNavigator);
    return noteNavigator ? <noteNavigator.default /> : null;
}
