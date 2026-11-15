import "./DesktopLayout.css";

import LaunchBar from "../widgets/launch_bar/LaunchBar.js";

/** The desktop layout as a single Preact tree, which `desktop_layout.tsx` is moved into piece by piece. */
export default function DesktopLayout() {
    const isHorizontal = window.glob.layoutOrientation === "horizontal";
    const orientation = isHorizontal ? "horizontal" : "vertical";
    const launcherPane = (
        <div id="launcher-pane" className={orientation}>
            <LaunchBar />
        </div>
    );

    return (
        <div id="root-widget" className={`desktop-layout ${orientation}-layout`}>
            {isHorizontal && launcherPane}
            <div id="horizontal-main-container">
                {!isHorizontal && launcherPane}
            </div>
        </div>
    );
}
