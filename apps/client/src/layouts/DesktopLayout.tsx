import "./DesktopLayout.css";

import type { AppContext } from "../components/app_context.js";
import { ReactWrappedWidget } from "../widgets/basic_widget.js";

/** The desktop layout as a single Preact tree, which `desktop_layout.tsx` is moved into piece by piece. */
export default class DesktopLayout {

    getRootWidget(_appContext: AppContext) {
        return new ReactWrappedWidget(<DesktopLayoutRoot />);
    }

}

function DesktopLayoutRoot() {
    return (
        <div id="root-widget" className="desktop-layout">
            Hello world
        </div>
    );
}
