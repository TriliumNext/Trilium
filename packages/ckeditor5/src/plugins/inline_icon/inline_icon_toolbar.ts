import bxReflectHorizontal from "boxicons/svg/regular/bx-reflect-horizontal.svg?raw";
import {
    addListToDropdown, Collection, type Command, createDropdown,
    type ListDropdownItemDefinition, type LocaleTranslate, Plugin, UIModel, WidgetToolbarRepository
} from "ckeditor5";

import InlineIconEditing, {
    ICON, ICON_TRANSFORM_COMMAND, ICON_TRANSFORMS, type IconTransform
} from "./inline_icon_editing.js";
import InlineIconUI, { CHANGE_ICON } from "./inline_icon_ui.js";

/**
 * The balloon shown over a selected icon, and the controls in it.
 *
 * `WidgetToolbarRepository` positions the balloon and shows or hides it, so this plugin only lists
 * the items and identifies the view element they apply to.
 */
export default class InlineIconToolbar extends Plugin {

    public static get pluginName() {
        return "InlineIconToolbar" as const;
    }

    public static get requires() {
        return [ WidgetToolbarRepository, InlineIconEditing, InlineIconUI ] as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.ui.componentFactory.add(ICON_TRANSFORM_COMMAND, (locale) => {
            // Always registered: InlineIconEditing is loaded before this plugin.
            const command = editor.commands.get(ICON_TRANSFORM_COMMAND) as Command;
            const dropdown = createDropdown(locale);

            dropdown.buttonView.set({
                label: t("Transform icon"),
                icon: bxReflectHorizontal,
                tooltip: true
            });

            dropdown.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(dropdown, "execute", (evt) => {
                // The list delegates its buttons' `execute` here, so the source is an item's model.
                const { _iconTransform: transform } = evt.source as TransformItemModel;

                editor.execute(ICON_TRANSFORM_COMMAND, { transform });
                editor.editing.view.focus();
            });

            addListToDropdown(dropdown, transformItems(command, t), {
                ariaLabel: t("Transform icon")
            });

            return dropdown;
        });
    }

    afterInit() {
        this.editor.plugins.get(WidgetToolbarRepository).register(ICON, {
            ariaLabel: this.editor.t("Icon toolbar"),
            items: [ CHANGE_ICON, ICON_TRANSFORM_COMMAND ],
            getRelatedElement: (selection) => {
                const viewElement = selection.getSelectedElement();

                return viewElement?.getCustomProperty(ICON) ? viewElement : null;
            }
        });
    }

}

/** A list item's model; `_iconTransform` is the transform its button applies. */
interface TransformItemModel {
    _iconTransform: IconTransform | null;
}

/** The dropdown's items: upright, then each transform in {@link ICON_TRANSFORMS}. */
function transformItems(command: Command, t: LocaleTranslate) {
    const labels: Record<IconTransform, string> = {
        "bx-rotate-90": t("Rotate 90°"),
        "bx-rotate-180": t("Rotate 180°"),
        "bx-rotate-270": t("Rotate 270°"),
        "bx-flip-horizontal": t("Flip horizontally"),
        "bx-flip-vertical": t("Flip vertically")
    };

    const items = new Collection<ListDropdownItemDefinition>();

    items.add(transformItem(command, null, t("No transform")));
    items.add({ type: "separator" });

    for (const transform of ICON_TRANSFORMS) {
        items.add(transformItem(command, transform, labels[transform]));
    }

    return items;
}

/**
 * One choice, marked while the selected icon has that transform. They are radio items rather
 * than checkboxes because the transforms exclude one another (see {@link ICON_TRANSFORMS}).
 */
function transformItem(
    command: Command,
    transform: IconTransform | null,
    label: string
): ListDropdownItemDefinition {
    const model = new UIModel({
        _iconTransform: transform,
        label,
        role: "menuitemradio",
        withText: true
    });

    model.bind("isOn").to(command, "value", (value) => value === transform);

    return { type: "button", model };
}
