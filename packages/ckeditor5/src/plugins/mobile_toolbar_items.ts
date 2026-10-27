import bxCamera from "boxicons/svg/regular/bx-camera.svg?raw";
import bxSortDown from "boxicons/svg/regular/bx-sort-down.svg?raw";
import {
    _getLocalizedHeadingOptions as getLocalizedHeadingOptions,
    addListToDropdown,
    BlockQuote,
    ButtonView,
    CodeBlock,
    Collection,
    createDropdown,
    FontSize,
    Heading,
    IconBulletedList,
    IconCodeBlock,
    IconHeading1,
    IconHeading2,
    IconHeading3,
    IconHeading4,
    IconHeading5,
    IconHeading6,
    IconLink,
    IconListStyleArabicIndic,
    IconListStyleCircle,
    IconListStyleDecimal,
    IconListStyleDecimalLeadingZero,
    IconListStyleDisc,
    IconListStyleLowerLatin,
    IconListStyleLowerRoman,
    IconListStyleSquare,
    IconListStyleUpperLatin,
    IconListStyleUpperRoman,
    IconNumberedList,
    IconPaperClip,
    IconParagraph,
    IconQuote,
    IconTable,
    IconTodoList,
    List,
    ListItemView,
    ListView,
    Plugin,
    Table,
    TodoList,
    UIModel
} from "ckeditor5";
import type {
    Command, DropdownView, Editor, ListDropdownItemDefinition, ListStyleCommand, Locale, ModelElement
} from "ckeditor5";

import admonitionIcon from "../icons/admonition.svg?raw";
import blockTypeIcon from "../icons/block-type.svg?raw";
import AdmonitionEditing from "./admonition/admonition_editing.js";
import FileUploadUI from "./file_upload/file_upload_ui.js";
import { COMMAND_NAME as INTERNAL_LINK_COMMAND } from "./internallink.js";
import { openListAsMenu, type ToolbarGroupMenuItem } from "./toolbar_group_menu.js";

const HEADING_ICONS: Record<string, string> = {
    heading1: IconHeading1,
    heading2: IconHeading2,
    heading3: IconHeading3,
    heading4: IconHeading4,
    heading5: IconHeading5,
    heading6: IconHeading6
};

/** The sizes of the `insertTableMenu` tiles. A table grows from its row and column menus. */
const TABLE_ROWS = [2, 3];
const TABLE_COLUMNS = [2, 3, 4];

/** A row of the `blockType` list: the command that makes a block of that type, and what it shows. */
interface BlockType {
    label: string;
    icon: string;
    command: string;
    /** The heading of the `heading` command. */
    value?: string;
}

/**
 * Registers variants of toolbar items, most of them for the narrow toolbar of a phone. When a host
 * is configured, `ToolbarGroupMenu` opens their lists as the host application's menu.
 *
 * - `blockType`: what Notion calls "Turn into". The paragraph, the headings of the `heading`
 *   configuration, the bulleted, numbered and to-do lists and the code block, which replace each
 *   other, and the block quote and the admonition, which wrap the block. One dropdown, under an
 *   icon of its own rather than the name of the current block, which takes 8em.
 * - `fontSizeMenu`: the `fontSize` dropdown.
 * - `attachMenu`: the image upload, a photo taken with the camera when `attachMenu.camera` is set,
 *   and the rows of the `fileUpload` list as a list, under a paperclip. A row whose feature the
 *   editor lacks is left out.
 * - `addImage`: the image upload of the menu bar, labelled "Image", which the `attachMenu` row
 *   is too, for the insert menu.
 * - `addLink`: one link button, which opens the link dialog of the internal link button for a link to
 *   a note or to an address, in place of the separate `link` and `internalLink` buttons.
 * - `insertTableMenu`: common table sizes as tiles, in place of the size grid of `insertTable`,
 *   which needs a pointer that hovers over its cells.
 * - `listTypeMenu`, `listStartAt` and `listReversed`: the list properties of `ListProperties`,
 *   whose panel holds a form: the to-do list and the markers of bulleted and numbered lists as
 *   tiles, the markers under the kind of each, a button that asks the host for the number the list starts at
 *   (`listStartPrompt`), and a toggle for the order. The last two show only in a numbered list.
 */
export default class MobileToolbarItems extends Plugin {

    static get requires() {
        return [Heading, List, TodoList, CodeBlock, BlockQuote, AdmonitionEditing, FontSize, Table] as const;
    }

    static get pluginName() {
        return "MobileToolbarItems" as const;
    }

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("blockType", (locale) => this.createBlockTypeDropdown(locale));

        editor.ui.componentFactory.add("fontSizeMenu", () => {
            const dropdown = editor.ui.componentFactory.create("fontSize") as DropdownView;
            openListAsMenu(dropdown);
            return dropdown;
        });

        if (editor.ui.componentFactory.has("menuBar:uploadImage")) {
            editor.ui.componentFactory.add("addImage", () => {
                const button = editor.ui.componentFactory.create("menuBar:uploadImage") as ButtonView;
                button.label = editor.t("Image");
                return button;
            });
        }
        editor.ui.componentFactory.add("attachMenu", (locale) => this.createAttachDropdown(locale));
        editor.ui.componentFactory.add("insertTableMenu", (locale) => this.createInsertTableDropdown(locale));
        editor.ui.componentFactory.add("addLink", (locale) => this.createAddLinkButton(locale));

        if (editor.commands.get("listStyle")) {
            editor.ui.componentFactory.add("listTypeMenu", (locale) => this.createListTypeDropdown(locale));
        }
        if (editor.commands.get("listStart")) {
            editor.ui.componentFactory.add("listStartAt", (locale) => this.createListStartButton(locale));
        }
        if (editor.commands.get("listReversed")) {
            editor.ui.componentFactory.add("listReversed", (locale) => this.createListReversedButton(locale));
        }
    }

    private createListTypeDropdown(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        const styleCommand = editor.commands.get("listStyle") as ListStyleCommand;
        const todoCommand = editor.commands.get("todoList") as Command;
        const commands = [styleCommand, todoCommand, ...["bulletedList", "numberedList"].map((name) =>
            editor.commands.get(name) as Command)];
        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ label: t("List type"), tooltip: true });
        dropdown.buttonView.bind("icon").toMany(commands, "value", () =>
            getCurrentListStyle(editor)?.icon ?? (todoCommand.value ? IconTodoList : IconBulletedList));
        dropdown.bind("isEnabled").toMany(commands, "isEnabled", (...enabled) => enabled.some(Boolean));

        // `listStyle` turns a list of the other kind, a to-do list included, into one of the marker's.
        const kinds = [["bulleted", t("Bulleted List")], ["numbered", t("Numbered List")]] as const;
        openListAsMenu(dropdown, {
            layout: "tiles",
            describe: (run) => {
                const current = getCurrentListStyle(editor);
                const items: ToolbarGroupMenuItem[] = [{
                    kind: "entry", label: t("To-do List"), icon: IconTodoList,
                    isEnabled: todoCommand.isEnabled, isOn: todoCommand.value === true,
                    run: run(() => {
                        if (!todoCommand.value) {
                            editor.execute("todoList");
                        }
                        editor.editing.view.focus();
                    })
                }];
                for (const [listType, heading] of kinds) {
                    items.push({ kind: "heading", label: heading });
                    for (const style of getListStyles(editor, listType)) {
                        if (!styleCommand.isStyleTypeSupported(style.type)) {
                            continue;
                        }
                        items.push({
                            kind: "entry", label: style.label, icon: style.icon,
                            isEnabled: styleCommand.isEnabled, isOn: style.type === current?.type,
                            run: run(() => {
                                editor.execute("listStyle", { type: style.type });
                                editor.editing.view.focus();
                            })
                        });
                    }
                }
                return items;
            }
        });
        return dropdown;
    }

    private createListStartButton(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        const command = editor.commands.get("listStart") as Command & { value: number | null };
        const button = new ButtonView(locale);
        button.set({ withText: true });
        button.bind("label").to(command, "value", (value: number | null) => `${t("Start at")} ${value ?? 1}`);
        button.bind("isEnabled").to(command);
        button.bind("isVisible").to(command, "isEnabled");
        button.on("execute", async () => {
            const prompt = editor.config.get("listStartPrompt");
            const startIndex = await prompt?.(t("Start at"), command.value ?? 1);
            if (startIndex !== null && startIndex !== undefined) {
                editor.execute("listStart", { startIndex });
            }
            editor.editing.view.focus();
        });
        return button;
    }

    private createListReversedButton(locale: Locale) {
        const editor = this.editor;
        const command = editor.commands.get("listReversed") as Command & { value: boolean | null };
        const button = new ButtonView(locale);
        button.set({ label: editor.t("Reversed order"), icon: bxSortDown, tooltip: true, isToggleable: true });
        button.bind("isOn").to(command, "value", (value: boolean | null) => !!value);
        button.bind("isEnabled").to(command);
        button.bind("isVisible").to(command, "isEnabled");
        button.on("execute", () => {
            editor.execute("listReversed", { reversed: !command.value });
            editor.editing.view.focus();
        });
        return button;
    }

    private createAddLinkButton(locale: Locale) {
        const editor = this.editor;
        const button = new ButtonView(locale);
        button.set({ label: editor.t("Link"), icon: IconLink, tooltip: true });

        // Registered by `InternalLinkPlugin`, which every editor with this toolbar loads.
        const command = editor.commands.get(INTERNAL_LINK_COMMAND);
        if (command) {
            button.bind("isEnabled").to(command);
        } else {
            button.isEnabled = false;
        }
        button.on("execute", () => editor.execute(INTERNAL_LINK_COMMAND));
        return button;
    }

    private createInsertTableDropdown(locale: Locale) {
        const editor = this.editor;
        // Always registered: `Table` loads `TableEditing`.
        const command = editor.commands.get("insertTable") as Command;

        const items = new Collection<ListDropdownItemDefinition>();
        for (const rows of TABLE_ROWS) {
            for (const columns of TABLE_COLUMNS) {
                const model = new UIModel({
                    // The label of the size grid of the `insertTable` dropdown.
                    label: `${rows} × ${columns}`, icon: tableSizeIcon(rows, columns), withText: true,
                    tableSize: { rows, columns }
                });
                items.add({ type: "button", model });
            }
        }

        const dropdown = createDropdown(locale);
        addListToDropdown(dropdown, items, { role: "menu" });
        dropdown.buttonView.set({ label: editor.t("Insert table"), icon: IconTable, tooltip: true });
        dropdown.bind("isEnabled").to(command);
        dropdown.on("execute", (evt) => {
            const { tableSize } = evt.source as ButtonView & { tableSize: { rows: number; columns: number } };
            editor.execute("insertTable", tableSize);
            editor.editing.view.focus();
        });
        openListAsMenu(dropdown, { layout: "tiles" });
        return dropdown;
    }

    private createAttachDropdown(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        const buttons: ButtonView[] = [];

        if (editor.ui.componentFactory.has("addImage")) {
            buttons.push(editor.ui.componentFactory.create("addImage") as ButtonView);

            if (editor.config.get("attachMenu")?.camera) {
                const camera = editor.ui.componentFactory.create("menuBar:uploadImage") as ButtonView & {
                    allowMultipleFiles: boolean;
                };
                camera.set({ label: t("Camera"), icon: bxCamera, allowMultipleFiles: false });
                // Rendering adds the file input, which `capture` points at the rear camera.
                camera.render();
                camera.element?.querySelector("input[type=file]")?.setAttribute("capture", "environment");
                buttons.push(camera);
            }
        }
        if (editor.plugins.has(FileUploadUI)) {
            buttons.push(...editor.plugins.get(FileUploadUI).createListButtons(locale));
        }

        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ label: t("Attach file"), icon: IconPaperClip, tooltip: true });
        const listView = dropdown.listView = new ListView(locale);
        for (const button of buttons) {
            const item = new ListItemView(locale);
            item.children.add(button);
            listView.items.add(item);
            button.delegate("execute").to(dropdown);
        }
        dropdown.panelView.children.add(listView);
        dropdown.bind("isEnabled").toMany(buttons, "isEnabled", (...enabled) => enabled.some(Boolean));

        openListAsMenu(dropdown);
        return dropdown;
    }

    private createBlockTypeDropdown(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        const accessibleLabel = t("Block type");
        const command = (name: string) => editor.commands.get(name) as Command;

        const blocks: BlockType[] = getLocalizedHeadingOptions(editor).map((option) => (option.model === "paragraph"
            ? { label: option.title, icon: IconParagraph, command: "paragraph" }
            : { label: option.title, icon: HEADING_ICONS[option.model], command: "heading", value: option.model }));
        const lists: BlockType[] = [
            { label: t("Bulleted List"), icon: IconBulletedList, command: "bulletedList" },
            { label: t("Numbered List"), icon: IconNumberedList, command: "numberedList" },
            { label: t("To-do List"), icon: IconTodoList, command: "todoList" }
        ];
        const code: BlockType = { label: t("Code block"), icon: IconCodeBlock, command: "codeBlock" };
        const wrappers: BlockType[] = [
            { label: t("Block quote"), icon: IconQuote, command: "blockQuote" },
            { label: t("Admonition"), icon: admonitionIcon, command: "admonition" }
        ];
        const groups = [blocks, lists, [code, ...wrappers]];
        const commands = [...new Set(groups.flat().map((type) => type.command))].map(command);

        // A list item is a paragraph too, so the lists are asked first. A wrapper is not a type of
        // the block, which keeps its own.
        const current = () => lists.find((type) => command(type.command).value === true)
            ?? (command("codeBlock").value ? code : undefined)
            ?? blocks.find((type) => (type.value
                ? command("heading").value === type.value
                : command("paragraph").value === true));
        const isOn = (type: BlockType) => (wrappers.includes(type)
            ? Boolean(command(type.command).value)
            : current() === type);

        const items = new Collection<ListDropdownItemDefinition>();
        for (const [index, group] of groups.entries()) {
            if (index > 0) {
                items.add({ type: "separator" });
            }
            for (const type of group) {
                const model = new UIModel({
                    label: type.label, icon: type.icon, role: "menuitemradio", withText: true, blockType: type
                });
                model.bind("isOn").toMany(commands, "value", () => isOn(type));
                items.add({ type: "button", model });
            }
        }

        const dropdown = createDropdown(locale);
        addListToDropdown(dropdown, items, { ariaLabel: accessibleLabel, role: "menu" });
        dropdown.buttonView.set({ icon: blockTypeIcon, withText: false, tooltip: accessibleLabel });
        dropdown.buttonView.bind("label").toMany(commands, "value", () => current()?.label ?? accessibleLabel);
        dropdown.buttonView.bind("ariaLabel").toMany(commands, "value", () => {
            const type = current();
            return type ? `${type.label}, ${accessibleLabel}` : accessibleLabel;
        });
        dropdown.bind("isEnabled").toMany(commands, "isEnabled", (...enabled) => enabled.some(Boolean));

        dropdown.on("execute", (evt) => {
            const { blockType } = evt.source as ButtonView & { blockType: BlockType };
            this.setBlockType(blockType, { lists, code, wrappers });
        });
        openListAsMenu(dropdown, { layout: "tiles" });
        return dropdown;
    }

    /**
     * Turns the selected blocks into `type` as one undo step, as Notion's "Turn into" does: a list
     * is made of paragraphs, a paragraph, a heading or a code block picked in a list leaves the
     * list, and anything but a code block picked in one leaves it. A wrapper toggles around the
     * blocks instead.
     */
    private setBlockType(type: BlockType, { lists, code, wrappers }: {
        lists: BlockType[];
        code: BlockType;
        wrappers: BlockType[];
    }) {
        const editor = this.editor;
        const isOn = (name: string) => Boolean(editor.commands.get(name)?.value);

        editor.model.change(() => {
            if (wrappers.includes(type)) {
                editor.execute(type.command);
                return;
            }

            const currentList = lists.find((list) => isOn(list.command));
            if (isOn("codeBlock") && type !== code) {
                editor.execute("codeBlock", { forceValue: false });
            }
            if (lists.includes(type)) {
                if (!isOn("paragraph")) {
                    editor.execute("paragraph");
                }
                editor.execute(type.command, { forceValue: true });
                return;
            }

            if (currentList) {
                editor.execute(currentList.command, { forceValue: false });
            }
            if (type === code) {
                editor.execute(type.command, { forceValue: true });
            } else {
                editor.execute(type.command, type.value ? { value: type.value } : undefined);
            }
        });
        editor.editing.view.focus();
    }
}

/** The styles of `ListPropertiesUI`, as it offers them, by the list type they apply to. */
const LIST_STYLES = [
    { listType: "bulleted", type: "disc", icon: IconListStyleDisc },
    { listType: "bulleted", type: "circle", icon: IconListStyleCircle },
    { listType: "bulleted", type: "square", icon: IconListStyleSquare },
    { listType: "numbered", type: "decimal", icon: IconListStyleDecimal },
    { listType: "numbered", type: "decimal-leading-zero", icon: IconListStyleDecimalLeadingZero },
    { listType: "numbered", type: "lower-roman", icon: IconListStyleLowerRoman },
    { listType: "numbered", type: "upper-roman", icon: IconListStyleUpperRoman },
    { listType: "numbered", type: "lower-latin", icon: IconListStyleLowerLatin },
    { listType: "numbered", type: "upper-latin", icon: IconListStyleUpperLatin },
    { listType: "numbered", type: "arabic-indic", icon: IconListStyleArabicIndic }
] as const;

/** The style a list of each type is drawn with when it has none of its own. */
const DEFAULT_LIST_STYLES: Record<string, string | undefined> = { bulleted: "disc", numbered: "decimal" };

/**
 * The style of the list at the selection, or the one a list with no style of its own is drawn
 * with, or `undefined` outside a bulleted or numbered list.
 */
function getCurrentListStyle(editor: Editor) {
    // In the document, a position is always in an element.
    const block = editor.model.document.selection.getFirstPosition()?.parent as ModelElement | undefined;
    const listType = block?.getAttribute("listType");
    const value = editor.commands.get("listStyle")?.value;
    const type = !value || value === "default" ? DEFAULT_LIST_STYLES[String(listType)] : value;
    return LIST_STYLES.find((style) => style.listType === listType && style.type === type);
}

/** The styles of a list of `listType`, named as `ListPropertiesUI` names them. */
function getListStyles(editor: Editor, listType: "bulleted" | "numbered") {
    const t = editor.t;
    const labels: Record<string, string> = {
        "disc": t("Disc"),
        "circle": t("Circle"),
        "square": t("Square"),
        "decimal": t("Decimal"),
        "decimal-leading-zero": t("Decimal with leading zero"),
        "lower-roman": t("Lower–roman"),
        "upper-roman": t("Upper-roman"),
        "lower-latin": t("Lower-latin"),
        "upper-latin": t("Upper-latin"),
        "arabic-indic": t("Arabic-indic")
    };
    return LIST_STYLES.filter((style) => style.listType === listType)
        .map((style) => ({ ...style, label: labels[style.type] }));
}

/** An icon of a table of `rows` × `columns` cells, each a filled square, as the size grid draws them. */
function tableSizeIcon(rows: number, columns: number) {
    const size = 20;
    const gap = 2;
    const width = (size - gap * (columns - 1)) / columns;
    const height = (size - gap * (rows - 1)) / rows;
    const cells: string[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const x = column * (width + gap);
            const y = row * (height + gap);
            cells.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1"/>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${cells.join("")}</svg>`;
}

declare module "ckeditor5" {
    interface EditorConfig {
        /**
         * Asks for the number a list starts at, for `listStartAt`, with the label of the field and the
         * current number. Resolves to `null` when nothing is to change.
         */
        listStartPrompt?(label: string, current: number): Promise<number | null>;

        attachMenu?: {
            /**
             * Whether `attachMenu` offers a photo taken with the camera. Desktop browsers ignore the
             * `capture` attribute of a file input, so there the row opens the same picker as "Image".
             */
            camera?: boolean;
        };
    }
}
