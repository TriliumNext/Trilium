import { Plugin } from "ckeditor5";

/**
 * Keeps the "Powered by CKEditor" badge from starting. With a GPL license, `PoweredBy` pins a
 * balloon to the focused editable and measures and moves it on every scroll and every UI update.
 * `PoweredBy` checks `_isEnabled()` when the editor is ready, after the plugins are initialized.
 */
export default class NoPoweredByBadge extends Plugin {

    static get pluginName() {
        return "NoPoweredByBadge" as const;
    }

    init() {
        const poweredBy = this.editor.ui.poweredBy as unknown as { _isEnabled(): boolean };
        poweredBy._isEnabled = () => false;
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [NoPoweredByBadge.pluginName]: NoPoweredByBadge;
    }
}
