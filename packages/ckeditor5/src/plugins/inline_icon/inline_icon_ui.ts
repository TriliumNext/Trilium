import bxSticker from "boxicons/svg/regular/bx-sticker.svg?raw";
import { ButtonView, type Command, ContextualBalloon, Plugin } from "ckeditor5";

import HostedBalloon from "../../hosted_balloon.js";
import { INSERT_ICON_COMMAND } from "./inline_icon_editing.js";

/**
 * The button `InlineIconToolbar` puts in the balloon over a selected icon. It opens the same
 * picker as the insert button, because `INSERT_ICON_COMMAND` replaces a selected icon.
 */
export const CHANGE_ICON = "changeIcon";

/**
 * The buttons that insert or replace an icon, and the balloon the picking happens in.
 *
 * The editor positions the balloon and takes it down; the application renders its own picker into
 * it through `inlineIcon.showPicker`, the one place every installed icon pack is searchable. A host with
 * no room for a balloon shows the picker its own way and returns nothing to release.
 */
export default class InlineIconUI extends Plugin {

    public static get pluginName() {
        return "InlineIconUI" as const;
    }

    public static get requires() {
        return [ ContextualBalloon ] as const;
    }

    private picker = new HostedBalloon(this.editor, "icon-picker-balloon");

    init() {
        const editor = this.editor;
        const t = editor.t;

        this.addPickerButton(INSERT_ICON_COMMAND, t("Icon"));
        this.addPickerButton(CHANGE_ICON, t("Change icon"));
    }

    public override destroy() {
        // Before the base class stops the listeners the balloon is taken down through.
        this.picker.hide();
        super.destroy();
    }

    /** Opens the picker; the `/` palette calls this as well as the toolbar buttons. */
    public showPicker() {
        const editor = this.editor;

        this.picker.show((container) => editor.config.get("inlineIcon")?.showPicker({
            container,
            onSelect: (iconClass) => {
                this.picker.hide();
                editor.execute(INSERT_ICON_COMMAND, { iconClass });
                editor.editing.view.focus();
            }
        }) ?? null);
    }

    /**
     * One button that opens the picker. Both buttons execute `INSERT_ICON_COMMAND` and take their
     * enabled state from it, so both are disabled where an icon cannot be inserted.
     */
    private addPickerButton(name: string, label: string) {
        const editor = this.editor;

        editor.ui.componentFactory.add(name, (locale) => {
            // Always registered: InlineIconEditing is loaded beside this plugin.
            const command = editor.commands.get(INSERT_ICON_COMMAND) as Command;
            const view = new ButtonView(locale);

            view.set({
                label,
                icon: bxSticker,
                tooltip: true
            });

            view.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(view, "execute", () => this.showPicker());

            return view;
        });
    }

}

/** What the editor asks the host's icon picker for. */
export interface IconPickerRequest {
    /** The element to paint the picker into, which the editor owns and places. */
    container: HTMLElement;
    /** Receives the class of the icon picked, e.g. `bx bx-star`. */
    onSelect(iconClass: string): void;
}

declare module "ckeditor5" {
    interface EditorConfig {
        inlineIcon?: {
            /**
             * Paints the host's icon picker into `request.container`, and answers with the way to
             * take it down again. A host that shows the picker somewhere of its own (a phone, which
             * has no room for a balloon) leaves the container alone and answers `null`.
             */
            showPicker(request: IconPickerRequest): (() => void) | null;
        };
    }
}
