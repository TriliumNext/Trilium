import autoIcons from "@wxt-dev/auto-icons";
import { defineWxtModule } from "wxt/modules";

/**
 * Generates the extension's icons with `@wxt-dev/auto-icons`, from Trilium's purple development
 * icon in development builds, as the desktop application does, and from the logo otherwise.
 */
export default defineWxtModule({
    name: "trilium-icons",
    setup(wxt) {
        const isDevelopment = wxt.config.mode === "development";
        return autoIcons.setup?.(wxt, {
            baseIconPath: isDevelopment
                ? "../desktop/electron-forge/app-icon/png/256x256-dev.png"
                : "assets/icon.png",
            developmentIndicator: false
        });
    }
});
