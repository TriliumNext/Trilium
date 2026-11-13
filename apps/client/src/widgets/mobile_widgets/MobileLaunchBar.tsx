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
 * The launch bar of the mobile layout. It is a bar along the bottom edge, or the top edge of a
 * tablet, with the global menu at its end. With the `mobileNavigationRail` option on a tablet-wide
 * screen it is a rail along the start edge instead: the global menu and the note tree come first,
 * and every button shows its title under its icon. `MobileLaunchBar.css` then opens the global menu,
 * the note tree and the note's actions as panels beside the note.
 *
 * `component` stays in the class list because `BasicWidget` adds it to this element, and a change of
 * `className` here would drop it.
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
