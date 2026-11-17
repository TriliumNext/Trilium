import MobileLayout from "./layouts/MobileLayout.js";
import { renderLayout } from "./layouts/render_layout.js";
import { showStartupFailure } from "./services/splash.js";

const root = await renderLayout(MobileLayout);

// After the first render: the components that execute commands, the tabs, which wait for froca's
// note tree in any case, and the handlers of links and pasted images.
void import("./components/app_startup.js")
    .then(({ startAppAroundLayout }) => startAppAroundLayout(root))
    .catch(showStartupFailure);
