import {
    ButtonView,
    type Command,
    type Editor,
    IconLink,
    IconNextArrow,
    IconPlus,
    IconPreviousArrow,
    IconRemove,
    isWidget,
    Plugin,
    type ViewDocumentSelection,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";

import tabsIcon from "../../icons/tabs.svg?raw";
import { TABS_WIDGET_PROPERTY } from "./constants.js";

/**
 * The insert button for tabs blocks and the contextual toolbar that adds, removes and reorders
 * tabs while the selection is inside a block.
 */
export default class TabsUI extends Plugin {

    public static get pluginName() {
        return "TabsUI" as const;
    }

    public static get requires() {
        return [WidgetToolbarRepository] as const;
    }

    public init(): void {
        const t = this.editor.t;
        this.addButton("tabs", t("Tabs"), tabsIcon);
        this.addButton("insertTab", t("Add tab"), IconPlus);
        this.addButton("removeTab", t("Remove tab"), IconRemove);
        this.addButton("moveTabLeft", t("Move tab left"), IconPreviousArrow);
        this.addButton("moveTabRight", t("Move tab right"), IconNextArrow);
        this.addCopyLinkButton();
    }

    public afterInit(): void {
        const t = this.editor.t;
        this.editor.plugins.get(WidgetToolbarRepository).register("tabs", {
            ariaLabel: t("Tabs toolbar"),
            items: ["insertTab", "removeTab", "|", "moveTabLeft", "moveTabRight", "|", "copyTabLink"],
            getRelatedElement: getTabsWidget
        });
    }

    /** Adds the button that copies a link to the tab holding the selection, through the host. */
    private addCopyLinkButton() {
        const editor = this.editor;
        editor.ui.componentFactory.add("copyTabLink", locale => {
            const button = new ButtonView(locale);
            button.set({ label: editor.t("Copy link to tab"), icon: IconLink, tooltip: true });

            const command = editor.commands.get("assignTabReference") as Command;
            button.bind("isEnabled").to(command, "isEnabled");
            this.listenTo(button, "execute", () => getHost(editor).copyTabReference?.());
            return button;
        });
    }

    private addButton(name: string, label: string, icon: string) {
        const editor = this.editor;
        editor.ui.componentFactory.add(name, locale => {
            const button = new ButtonView(locale);
            button.set({ label, icon, tooltip: true });

            // TabsEditing, which TabsUI requires, registers every command before this runs.
            const command = editor.commands.get(name) as Command;
            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute(name);
                editor.editing.view.focus();
            });
            return button;
        });
    }
}

/** Returns the host component of `editor`, which copies links. */
function getHost(editor: Editor) {
    return glob.getComponentByEl<EditorComponent>(editor.editing.view.getDomRoot());
}

/** Returns the innermost tabs widget that is selected or holds the selection. */
function getTabsWidget(selection: ViewDocumentSelection): ViewElement | null {
    const selected = selection.getSelectedElement();
    if (selected && isTabsWidget(selected)) {
        return selected;
    }

    let node = selection.getFirstPosition()?.parent ?? null;
    while (node) {
        if (node.is("element") && isTabsWidget(node)) {
            return node;
        }
        node = node.parent;
    }
    return null;
}

function isTabsWidget(element: ViewElement) {
    return !!element.getCustomProperty(TABS_WIDGET_PROPERTY) && isWidget(element);
}
