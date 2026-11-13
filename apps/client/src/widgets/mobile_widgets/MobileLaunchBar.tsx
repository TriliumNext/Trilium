import "./MobileLaunchBar.css";

import { useContext } from "preact/hooks";

import { t } from "../../services/i18n";
import GlobalMenu from "../buttons/global_menu";
import { LaunchBarActionButton, LaunchBarContext } from "../launch_bar/launch_bar_widgets";
import LauncherContainer from "../launch_bar/LauncherContainer";
import { useBodyClass, useNavigationRail, useTriliumOptionBool } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";

const RAIL_CONTEXT = { isHorizontalLayout: false, showLabels: true } as const;

/**
 * The mobile launch bar: a bar along the edge, or a labeled navigation rail on a tablet-wide screen
 * with the `mobileNavigationRail` option on. `component` is the class `BasicWidget` gives it.
 */
export default function MobileLaunchBar() {
    const isNavigationRail = useNavigationRail();
    const parentComponent = useContext(ParentComponent);
    useBodyClass("navigation-rail", isNavigationRail);

    if (!isNavigationRail) {
        return (
            <div id="launcher-pane" className="component horizontal">
                <LauncherContainer isHorizontalLayout />
                <GlobalMenu isHorizontalLayout />
            </div>
        );
    }

    return (
        <div id="launcher-pane" className="component vertical navigation-rail">
            <GlobalMenu
                isHorizontalLayout
                showLabel
                // The menu opens in the panel of the tree.
                onShown={() => parentComponent?.triggerCommand("hideLeftPane")}
            />
            <LaunchBarContext.Provider value={RAIL_CONTEXT}>
                <NoteTreeButton />
            </LaunchBarContext.Provider>
            <LauncherContainer isHorizontalLayout={false} showLabels />
        </div>
    );
}

/** Opens and closes the note tree beside the note, and is marked while the tree is open. */
function NoteTreeButton() {
    const parentComponent = useContext(ParentComponent);
    const [ isTreeShown ] = useTriliumOptionBool("leftPaneVisible");

    return (
        <LaunchBarActionButton
            className="note-tree-launcher"
            icon="bx bx-sitemap"
            text={t("note_tree.back-to-tree")}
            active={isTreeShown}
            aria-pressed={isTreeShown}
            onClick={() => parentComponent?.triggerCommand("toggleLeftPane")}
        />
    );
}
