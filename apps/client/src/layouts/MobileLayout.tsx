import "./MobileLayout.css";

import GlobalMenu from "../widgets/buttons/global_menu.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";

/** The mobile layout as a single Preact tree, which `mobile_layout.tsx` is moved into piece by piece. */
export default function MobileLayout() {
    return (
        <div id="root-widget" className="mobile-layout horizontal-layout">
            <div id="mobile-rest-container" />
            <div id="mobile-bottom-bar">
                <div id="launcher-pane" className="horizontal">
                    <LauncherContainer isHorizontalLayout={true} />
                    <GlobalMenu isHorizontalLayout={true} />
                </div>
            </div>
        </div>
    );
}
