import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    BlockQuote,
    ClassicEditor,
    CodeBlock,
    Command,
    DropdownView,
    Essentials,
    FontSize,
    Heading,
    HorizontalLine,
    IconBulletedList,
    IconCodeBlock,
    IconHeading2,
    IconHeading3,
    IconImageUpload,
    IconLink,
    IconNumberedList,
    IconPaperClip,
    IconParagraph,
    IconQuote,
    IconTable,
    IconTodoList,
    Image,
    ImageUpload,
    List,
    ListProperties,
    IconListStyleCircle,
    IconListStyleDecimal,
    IconListStyleDisc,
    IconListStyleLowerRoman,
    Paragraph,
    Plugin,
    Table,
    TodoList
} from "ckeditor5";
import bxCamera from "boxicons/svg/regular/bx-camera.svg?raw";
import bxLink from "boxicons/svg/regular/bx-link.svg?raw";
import bxShapeSquare from "boxicons/svg/regular/bx-shape-square.svg?raw";
import bxSortDown from "boxicons/svg/regular/bx-sort-down.svg?raw";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import admonitionIcon from "../icons/admonition.svg?raw";
import blockTypeIcon from "../icons/block-type.svg?raw";
import AdmonitionEditing from "./admonition/admonition_editing.js";
import FileUploadUI from "./file_upload/file_upload_ui.js";
import InternalLinkPlugin from "./internallink.js";
import MobileToolbarItems from "./mobile_toolbar_items.js";
import ToolbarGroupMenu, { type ToolbarGroupMenuEntry, type ToolbarGroupMenuItem, type ToolbarGroupMenuRequest } from "./toolbar_group_menu.js";

const HEADING_OPTIONS = [
    { model: "paragraph", title: "Paragraph", class: "ck-heading_paragraph" },
    { model: "heading2", view: "h2", title: "Heading 2", class: "ck-heading_heading2" },
    { model: "heading3", view: "h3", title: "Heading 3", class: "ck-heading_heading3" }
] as const;

const BULLETED = "<paragraph listIndent=\"0\" listItemId=\"a00\" listType=\"bulleted\">foo[]</paragraph>";

describe("MobileToolbarItems", () => {
    let editor: ClassicEditor;

    // The width of the dropdown button needs the editor's stylesheet.
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Heading, List, TodoList, HorizontalLine, MobileToolbarItems], {
            toolbar: ["heading", "blockType"],
            heading: { options: [...HEADING_OPTIONS] }
        });
    });

    describe("blockType", () => {
        it("keeps one icon for every block, with the name of the current one in the accessible label", () => {
            const { buttonView } = getDropdown(editor, 1);
            expect(buttonView.withText).toBe(false);
            expect(buttonView.tooltip).toBe("Block type");

            const names: [string, string][] = [
                ["<paragraph>foo[]</paragraph>", "Paragraph"],
                ["<heading2>foo[]</heading2>", "Heading 2"],
                [BULLETED, "Bulleted List"],
                [BULLETED.replace("bulleted", "numbered"), "Numbered List"],
                [BULLETED.replace("bulleted", "todo"), "To-do List"],
                ["<codeBlock language=\"plaintext\">foo[]</codeBlock>", "Code block"],
                // A wrapper leaves the label to the block inside it.
                ["<blockQuote><heading2>foo[]</heading2></blockQuote>", "Heading 2"]
            ];
            for (const [data, name] of names) {
                setModelData(editor.model, data);
                expect(buttonView.icon).toBe(blockTypeIcon);
                expect(buttonView.ariaLabel).toBe(`${name}, Block type`);
            }
            expect(buttonView.element?.querySelector(".ck-button__icon")).not.toBeNull();

            // A block that is none of them, such as a horizontal line.
            setModelData(editor.model, "<paragraph>foo</paragraph>[<horizontalLine></horizontalLine>]");
            expect(buttonView.icon).toBe(blockTypeIcon);
            expect(buttonView.ariaLabel).toBe("Block type");
        });

        it("lists the headings, the lists, then code and the wrappers, each with its icon and the current block on", async () => {
            const { request, editor: menuEditor } = await createMenuEditor();
            setModelData(menuEditor.model, BULLETED);

            const shown = request();
            expect(shown.layout).toBe("tiles");
            const rows = shown.items;
            expect(rows.map(rowText)).toStrictEqual([
                "Paragraph", "Heading 2", "Heading 3", "—", "Bulleted List ✓", "Numbered List", "To-do List",
                "—", "Code block", "Block quote", "Admonition"
            ]);
            expect(icons(rows)).toStrictEqual([
                IconParagraph, IconHeading2, IconHeading3, IconBulletedList, IconNumberedList, IconTodoList,
                IconCodeBlock, IconQuote, admonitionIcon
            ]);

            // A wrapper is on alongside the block inside it.
            setModelData(menuEditor.model, `<blockQuote>${BULLETED}</blockQuote>`);
            expect(request().items.map(rowText).filter((row) => row.endsWith("✓")))
                .toStrictEqual(["Bulleted List ✓", "Block quote ✓"]);
            setModelData(menuEditor.model, "<aside admonitionType=\"tip\"><paragraph>foo[]</paragraph></aside>");
            expect(request().items.map(rowText).filter((row) => row.endsWith("✓")))
                .toStrictEqual(["Paragraph ✓", "Admonition ✓"]);

            setModelData(menuEditor.model, "<heading2>foo[]</heading2>");
            expect(request().items.map(rowText).filter((row) => row.endsWith("✓"))).toStrictEqual(["Heading 2 ✓"]);
            setModelData(menuEditor.model, "<paragraph>foo[]</paragraph>");
            expect(request().items.map(rowText).filter((row) => row.endsWith("✓"))).toStrictEqual(["Paragraph ✓"]);
        });

        it("turns any block into any other, a list into plain text, each in one undo step", async () => {
            const { request, editor: menuEditor } = await createMenuEditor();
            const run = (label: string) => entry(request().items, label).run?.();
            const model = () => getModelData(menuEditor.model, { withoutSelection: true });
            const listOf = (type: string) =>
                new RegExp(`^<paragraph listIndent="0" listItemId="[^"]+" listType="${type}">foo</paragraph>$`);

            setModelData(menuEditor.model, "<paragraph>foo[]</paragraph>");
            run("Bulleted List");
            expect(model()).toMatch(listOf("bulleted"));
            run("Numbered List");
            expect(model()).toMatch(listOf("numbered"));

            // A heading or a paragraph picked in a list leaves the list, as Notion's "Turn into" does.
            run("Heading 2");
            expect(model()).toBe("<heading2>foo</heading2>");
            run("To-do List");
            expect(model()).toMatch(listOf("todo"));
            run("Paragraph");
            expect(model()).toBe("<paragraph>foo</paragraph>");

            // A code block is a block type of its own, which a list or a heading leaves.
            run("Numbered List");
            run("Code block");
            expect(model()).toBe("<codeBlock language=\"plaintext\">foo</codeBlock>");
            run("Code block");
            expect(model()).toBe("<codeBlock language=\"plaintext\">foo</codeBlock>");
            run("Bulleted List");
            expect(model()).toMatch(listOf("bulleted"));
            run("Code block");
            run("Heading 2");
            expect(model()).toBe("<heading2>foo</heading2>");

            // The wrappers wrap the block, and unwrap it when picked again.
            run("Block quote");
            expect(model()).toBe("<blockQuote><heading2>foo</heading2></blockQuote>");
            run("Block quote");
            expect(model()).toBe("<heading2>foo</heading2>");
            run("Admonition");
            expect(model()).toBe("<aside admonitionType=\"note\"><heading2>foo</heading2></aside>");
            run("Admonition");
            expect(model()).toBe("<heading2>foo</heading2>");

            run("Heading 3");
            run("Bulleted List");
            menuEditor.execute("undo");
            expect(model()).toBe("<heading3>foo</heading3>");
        });

        it("opens CKEditor's own panel without a host, whose rows switch the block", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const dropdown = getDropdown(editor, 1);
            dropdown.isOpen = true;

            const labels = [...dropdown.element?.querySelectorAll(".ck-list__item .ck-button__label") ?? []];
            expect(labels.map((label) => label.textContent)).toStrictEqual([
                "Paragraph", "Heading 2", "Heading 3", "Bulleted List", "Numbered List", "To-do List",
                "Code block", "Block quote", "Admonition"
            ]);

            dropdown.element?.querySelectorAll<HTMLElement>(".ck-list__item .ck-button")[1]?.click();
            expect(editor.getData()).toBe("<h2>foo</h2>");
        });

        it("is enabled while any block type can be set", () => {
            const dropdown = getDropdown(editor, 1);
            expect(dropdown.isEnabled).toBe(true);
            editor.enableReadOnlyMode("spec");
            expect(dropdown.isEnabled).toBe(false);
        });

        it("is narrower than the heading dropdown", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const full = getDropdown(editor, 0).buttonView.element?.getBoundingClientRect().width ?? 0;
            const compact = getDropdown(editor, 1).buttonView.element?.getBoundingClientRect().width ?? 0;

            expect(full).toBeGreaterThan(100);
            expect(compact).toBeGreaterThan(0);
            expect(compact).toBeLessThan(full / 2);
        });
    });

    it("opens the font size list as a menu of the app, each row naming its size class and the current one on", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const menuEditor = await createTestEditor([Essentials, Paragraph, FontSize, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: ["fontSizeMenu"],
            toolbarGroupMenu: { host: () => host }
        });
        setModelData(menuEditor.model, "<paragraph>[<$text fontSize=\"big\">foo</$text>]</paragraph>");

        const dropdown = getDropdown(menuEditor, 0);
        dropdown.buttonView.fire("open");
        expect(dropdown.isOpen).toBe(false);

        const rows = (requests.at(-1)?.items ?? []) as ToolbarGroupMenuEntry[];
        expect(rows.map(({ label, isOn }) => ({ label, isOn }))).toStrictEqual([
            { label: "Tiny", isOn: false },
            { label: "Small", isOn: false },
            { label: "Default", isOn: false },
            { label: "Big", isOn: true },
            { label: "Huge", isOn: false }
        ]);
        expect(rows[0]?.className).toBe("ck-fontsize-option text-tiny");

        rows[4]?.run?.();
        expect(menuEditor.getData()).toBe("<p><span class=\"text-huge\">foo</span></p>");
    });

    it("opens table sizes as tiles, each inserting a table of that size", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const menuEditor = await createTestEditor([Essentials, Paragraph, Table, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: ["insertTableMenu"],
            toolbarGroupMenu: { host: () => host }
        });
        setModelData(menuEditor.model, "<paragraph>foo[]</paragraph>");

        const dropdown = getDropdown(menuEditor, 0);
        expect(dropdown.buttonView).toMatchObject({ label: "Insert table", icon: IconTable });
        menuEditor.enableReadOnlyMode("spec");
        expect(dropdown.isEnabled).toBe(false);
        menuEditor.disableReadOnlyMode("spec");
        expect(dropdown.isEnabled).toBe(true);

        dropdown.buttonView.fire("open");
        expect(dropdown.isOpen).toBe(false);
        const request = requests.at(-1);
        expect(request?.layout).toBe("tiles");
        const tiles = request?.items ?? [];
        expect(tiles.map(rowText)).toStrictEqual(["2 × 2", "2 × 3", "2 × 4", "3 × 2", "3 × 3", "3 × 4"]);
        // Each tile draws its own grid.
        expect(new Set(icons(tiles)).size).toBe(6);

        entry(tiles, "2 × 3").run?.();
        const data = menuEditor.getData();
        expect(data.match(/<tr>/g)).toHaveLength(2);
        expect(data.match(/<td>/g)).toHaveLength(6);
    });

    it("offers table sizes as a tile with a submenu in a group of tiles", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const menuEditor = await createTestEditor([Essentials, Paragraph, Table, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: [{ label: "Insert", icon: "plus", asMenu: { layout: "tiles" }, items: ["insertTableMenu"] }],
            toolbarGroupMenu: { host: () => host }
        });
        setModelData(menuEditor.model, "<paragraph>foo[]</paragraph>");

        getDropdown(menuEditor, 0).isOpen = true;
        const table = entry(requests.at(-1)?.items ?? [], "Insert table");
        expect(table.icon).toBe(IconTable);
        expect((table.children ?? []).map(rowText)).toStrictEqual(["2 × 2", "2 × 3", "2 × 4", "3 × 2", "3 × 3", "3 × 4"]);

        const size = (table.children ?? []).find((child) => child.kind === "entry" && child.label === "3 × 3");
        if (size?.kind !== "entry") throw new Error("expected a 3 × 3 row");
        size.run?.();
        expect(menuEditor.getData().match(/<td>/g)).toHaveLength(9);
    });
});

describe("addLink", () => {
    it("opens the link dialog of the internal link button, under the link icon", async () => {
        const showDialog = vi.fn();
        const editor = await createTestEditor([Essentials, Paragraph, InternalLinkPlugin, MobileToolbarItems], {
            toolbar: ["addLink"],
            internalLink: { showDialog }
        });
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");

        const button = editor.ui.view.toolbar.items.get(0) as unknown as {
            label: string; icon: string; isEnabled: boolean; fire(name: string): void;
        };
        expect([button.label, button.icon, button.isEnabled]).toStrictEqual(["Link", IconLink, true]);
        button.fire("execute");
        expect(showDialog).toHaveBeenCalledOnce();

        editor.enableReadOnlyMode("spec");
        expect(button.isEnabled).toBe(false);
    });

    it("is off in an editor without the internal link button, whose dialog it opens", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, MobileToolbarItems], { toolbar: ["addLink"] });
        expect((editor.ui.view.toolbar.items.get(0) as ButtonView).isEnabled).toBe(false);
    });
});

describe("list properties", () => {
    const BULLETED_LIST = "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\" listStyle=\"circle\">a[]</paragraph>";
    const NUMBERED_LIST = "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"numbered\" listStart=\"3\">a[]</paragraph>";

    async function createListEditor() {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const promptListStart = vi.fn(async () => 7 as number | null);
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, TodoList, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: ["listTypeMenu", "listStartAt", "listReversed"],
            list: { properties: { styles: true, startIndex: true, reversed: true } },
            toolbarGroupMenu: { host: () => host },
            listStartPrompt: promptListStart
        });
        const [style, start, reversed] = [...editor.ui.view.toolbar.items] as [DropdownView, ButtonView, ButtonView];
        return { editor, requests, promptListStart, style, start, reversed };
    }

    it("opens every list type as tiles under its kind, the current marker on", async () => {
        const { editor, requests, style } = await createListEditor();
        const open = () => {
            style.buttonView.fire("open");
            return requests.at(-1)?.items ?? [];
        };
        const listType = () => (["bulleted", "numbered", "todo"] as const)
            .find((type) => editor.commands.get(`${type}List`)?.value === true);
        setModelData(editor.model, BULLETED_LIST);
        expect(style.buttonView).toMatchObject({ label: "List type", icon: IconListStyleCircle });

        const tiles = open();
        expect(requests.at(-1)?.layout).toBe("tiles");
        expect(tiles.map(rowText)).toStrictEqual([
            "To-do List",
            "Bulleted List", "Disc", "Circle ✓", "Square",
            "Numbered List", "Decimal", "Decimal with leading zero", "Lower–roman", "Upper-roman",
            "Lower-latin", "Upper-latin", "Arabic-indic"
        ]);
        expect(icons(tiles)).toStrictEqual(expect.arrayContaining([IconListStyleDisc, IconListStyleLowerRoman, IconTodoList]));

        entry(tiles, "Disc").run?.();
        expect(editor.commands.get("listStyle")?.value).toBe("disc");
        expect(style.buttonView.icon).toBe(IconListStyleDisc);

        // A marker of the other kind converts the list, in one undo step.
        entry(open(), "Lower–roman").run?.();
        expect([listType(), editor.commands.get("listStyle")?.value]).toStrictEqual(["numbered", "lower-roman"]);
        editor.execute("undo");
        expect([listType(), editor.commands.get("listStyle")?.value]).toStrictEqual(["bulleted", "disc"]);

        entry(open(), "To-do List").run?.();
        expect(listType()).toBe("todo");
        expect(style.buttonView.icon).toBe(IconTodoList);
        expect(open().map(rowText)).toContain("To-do List ✓");
        // Picked again, it keeps the to-do list.
        entry(open(), "To-do List").run?.();
        expect(listType()).toBe("todo");
        entry(open(), "Square").run?.();
        expect([listType(), editor.commands.get("listStyle")?.value]).toStrictEqual(["bulleted", "square"]);

        // A list with no marker of its own shows the one it is drawn with.
        setModelData(editor.model, NUMBERED_LIST);
        expect(style.buttonView.icon).toBe(IconListStyleDecimal);
        expect(open().map(rowText)).toContain("Decimal ✓");
    });

    it("sets the start and the order of a numbered list, and shows neither for a bulleted one", async () => {
        const { editor, promptListStart, start, reversed } = await createListEditor();
        setModelData(editor.model, BULLETED_LIST);
        expect([start.isVisible, reversed.isVisible]).toStrictEqual([false, false]);

        setModelData(editor.model, NUMBERED_LIST);
        expect(start).toMatchObject({ isVisible: true, label: "Start at 3", withText: true });
        expect(reversed).toMatchObject({ isVisible: true, label: "Reversed order", icon: bxSortDown, withText: false, tooltip: true, isOn: false });

        start.fire("execute");
        expect(promptListStart).toHaveBeenCalledExactlyOnceWith("Start at", 3);
        await vi.waitFor(() => expect(editor.commands.get("listStart")?.value).toBe(7));
        expect(start.label).toBe("Start at 7");

        // A prompt closed without a number leaves the list as it is.
        promptListStart.mockResolvedValueOnce(null);
        start.fire("execute");
        await Promise.resolve();
        expect(editor.commands.get("listStart")?.value).toBe(7);

        reversed.fire("execute");
        expect(reversed.isOn).toBe(true);
        expect(editor.commands.get("listReversed")?.value).toBe(true);
    });

    it("leaves out the markers the list's `type` attribute cannot hold", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: ["listTypeMenu"],
            list: { properties: { styles: { useAttribute: true } } },
            toolbarGroupMenu: { host: () => host }
        });
        setModelData(editor.model, BULLETED_LIST);
        (editor.ui.view.toolbar.items.first as DropdownView).buttonView.fire("open");
        const labels = (requests.at(-1)?.items ?? []).map(rowText);
        expect(labels).toContain("Decimal");
        expect(labels).not.toContain("Decimal with leading zero");
        expect(labels).not.toContain("Arabic-indic");
    });

    it("asks for the start from 1 while the list has none, and only with a prompt to ask", async () => {
        const { editor, promptListStart, start } = await createListEditor();
        setModelData(editor.model, "<paragraph>a[]</paragraph>");
        start.fire("execute");
        expect(promptListStart).toHaveBeenCalledExactlyOnceWith("Start at", 1);

        const withoutPrompt = await createTestEditor([Essentials, Paragraph, List, ListProperties, MobileToolbarItems], {
            toolbar: ["listStartAt"],
            list: { properties: { startIndex: true } }
        });
        setModelData(withoutPrompt.model, NUMBERED_LIST);
        const execute = vi.spyOn(withoutPrompt, "execute");
        (withoutPrompt.ui.view.toolbar.items.first as ButtonView).fire("execute");
        await Promise.resolve();
        expect(execute).not.toHaveBeenCalled();
    });
});

describe("attachMenu", () => {
    /** Stands in for `FileUploadEditing` and `ContentEmbed`, whose commands the rows run. */
    class UploadCommands extends Plugin {
        init() {
            for (const name of ["fileUpload", "insertContentEmbed"]) {
                const command = new Command(this.editor);
                command.refresh();
                this.editor.commands.add(name, command);
            }
        }
    }

    async function createAttachEditor(camera = true) {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor([
            Essentials, Paragraph, Image, ImageUpload, UploadCommands, FileUploadUI, MobileToolbarItems, ToolbarGroupMenu
        ], {
            toolbar: ["attachMenu"],
            toolbarGroupMenu: { host: () => host },
            ...(camera ? { attachMenu: { camera: true } } : {})
        });
        return { editor, requests };
    }

    /** Runs `row` and returns the file input it opened, with the files it is given picked in it. */
    function pick(row: ToolbarGroupMenuEntry, files: File[]) {
        let input: HTMLInputElement | undefined;
        const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
            input = this;
        });
        row.run?.();
        click.mockRestore();
        if (!input) throw new Error(`expected "${row.label}" to open a file input`);

        const transfer = new DataTransfer();
        for (const file of files) transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change"));
        return input;
    }

    it("opens the image, camera and file uploads as a list under a paperclip", async () => {
        const { editor, requests } = await createAttachEditor();

        const dropdown = getDropdown(editor, 0);
        expect([dropdown.buttonView.label, dropdown.buttonView.icon]).toStrictEqual(["Attach file", IconPaperClip]);
        dropdown.buttonView.fire("open");

        const request = requests.at(-1);
        expect(request).toBeDefined();
        expect(request?.layout).toBeUndefined();
        const tiles = request?.items ?? [];
        expect(tiles.map(rowText)).toStrictEqual(["Image", "Camera", "Attach and embed file", "Attach file as a link"]);
        expect(icons(tiles)).toStrictEqual([IconImageUpload, bxCamera, bxShapeSquare, bxLink]);
    });

    it("leaves out the camera unless it is asked for", async () => {
        const { editor, requests } = await createAttachEditor(false);
        getDropdown(editor, 0).buttonView.fire("open");
        expect((requests.at(-1)?.items ?? []).map(rowText))
            .toStrictEqual(["Image", "Attach and embed file", "Attach file as a link"]);
    });

    it("picks images for the image tile, takes a photo for the camera tile, and any file for the others", async () => {
        const { editor, requests } = await createAttachEditor();
        const upload = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
        getDropdown(editor, 0).buttonView.fire("open");
        const tiles = requests.at(-1)?.items ?? [];
        const file = new File(["a"], "a.pdf", { type: "application/pdf" });
        const photo = new File(["p"], "photo.jpg", { type: "image/jpeg" });

        const image = pick(entry(tiles, "Image"), []);
        expect([image.accept, image.hasAttribute("capture")]).toStrictEqual([expect.stringContaining("image/png"), false]);
        const camera = pick(entry(tiles, "Camera"), [photo]);
        expect([camera.accept, camera.getAttribute("capture"), camera.multiple])
            .toStrictEqual([expect.stringContaining("image/jpeg"), "environment", false]);
        expect(pick(entry(tiles, "Attach and embed file"), [file]).accept).toBe("");
        pick(entry(tiles, "Attach file as a link"), [file]);
        expect(upload.mock.calls).toStrictEqual([
            ["uploadImage", { file: [photo] }],
            ["fileUpload", { file: [file], asEmbed: true }],
            ["fileUpload", { file: [file] }]
        ]);
    });

    it("offers the image upload on its own as a tile of a group", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor([Essentials, Paragraph, Image, ImageUpload, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: [{ label: "Insert", icon: "plus", asMenu: { layout: "tiles" }, items: ["addImage"] }],
            toolbarGroupMenu: { host: () => host }
        });
        const upload = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
        getDropdown(editor, 0).isOpen = true;

        const image = entry(requests.at(-1)?.items ?? [], "Image");
        expect(image.icon).toBe(IconImageUpload);
        const photo = new File(["p"], "photo.jpg", { type: "image/jpeg" });
        expect(pick(image, [photo]).hasAttribute("capture")).toBe(false);
        expect(upload.mock.calls).toStrictEqual([["uploadImage", { file: [photo] }]]);
    });

    it("leaves out the tiles of the features the editor lacks", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor([Essentials, Paragraph, MobileToolbarItems, ToolbarGroupMenu], {
            toolbar: ["attachMenu"],
            toolbarGroupMenu: { host: () => host }
        });

        const dropdown = getDropdown(editor, 0);
        expect(dropdown.isEnabled).toBe(false);
        dropdown.buttonView.fire("open");
        expect(requests.at(-1)?.items ?? []).toStrictEqual([]);
    });
});

/** An editor whose `blockType` opens as a menu of the app; `request()` opens it and returns what the host was given. */
async function createMenuEditor() {
    const requests: ToolbarGroupMenuRequest[] = [];
    const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
    const menuEditor = await createTestEditor(
        [Essentials, Paragraph, Heading, List, TodoList, MobileToolbarItems, ToolbarGroupMenu],
        {
            toolbar: ["blockType"],
            heading: { options: [...HEADING_OPTIONS] },
            toolbarGroupMenu: { host: () => host }
        }
    );
    const request = () => {
        getDropdown(menuEditor, 0).buttonView.fire("open");
        const shown = requests.at(-1);
        requests.at(-1)?.onClose(false);
        if (!shown) throw new Error("The host was asked to show no menu.");
        return shown;
    };
    return { editor: menuEditor, request };
}

/** A row as its label, with a check when it is on, or a rule as an em dash. */
function rowText(item: ToolbarGroupMenuItem) {
    if (item.kind === "separator") return "—";
    return item.isOn ? `${item.label} ✓` : item.label;
}

function icons(items: ToolbarGroupMenuItem[]) {
    return items.flatMap((item) => (item.kind === "entry" ? [item.icon] : []));
}

function entry(items: ToolbarGroupMenuItem[], label: string) {
    const found = items.find((item): item is ToolbarGroupMenuEntry => item.kind === "entry" && item.label === label);
    if (!found) throw new Error(`No "${label}" row in the menu.`);
    return found;
}

function getDropdown(editor: ClassicEditor, index: number) {
    const item = editor.ui.view.toolbar.items.get(index);
    if (!(item instanceof DropdownView)) {
        throw new Error(`toolbar item ${index} is not a dropdown`);
    }
    return item;
}
