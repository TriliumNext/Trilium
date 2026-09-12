import { BlockQuote, _getModelData as getModelData, _setModelData as setModelData, ButtonView, ClassicEditor, CodeBlockEditing, Dialog, Essentials, keyCodes, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
// Both glue plugins are imported for their type augmentations alone (`config.math`,
// `config.mermaid`). Only Mermaid's editing half is loaded as a plugin, being where its renderer
// lives; the maths pass calls `renderEquation` directly, so the feature itself is not needed.
import type {} from "../math/math.js";
import type {} from "../mermaid/mermaid.js";
import MermaidEditing from "../mermaid/mermaid_editing.js";
import TriliumAiAssistant from "./ai_assistant.js";
import { AI_TARGET_MARKER } from "./ai_assistant_editing.js";
import type { AiCompletionRequest, AiCompletionUsage, AiDiffFunction, AiQuickActionGroup, AiStreamCallback, AiStreamFunction } from "./ai_assistant_config.js";
import AiAssistantUI from "./ai_assistant_ui.js";

// ---- Typed views of the dropdown internals ----

/** A leaf entry: an action the user can pick. */
interface MenuButtonView {
    id: string;
    label?: string;
    isEnabled: boolean;
    element?: HTMLElement | null;
    fire(event: string): void;
}

/** A submenu entry: a group that opens rather than listing its actions inline. */
interface NestedMenuView {
    id: string;
    isEnabled: boolean;
    buttonView: { label?: string; element?: HTMLElement | null };
    /** A separator is a plain view: no `childView`, the same as at the top level. */
    listView: { items: Array<{ childView?: MenuButtonView }> };
}

interface QuickActionsDropdown {
    isOpen: boolean;
    isEnabled: boolean;
    class?: string;
    buttonView: SplitButtonView;
    /** Holds the menu once it is open; a redraw has to leave exactly one behind. */
    panelView: { children: { length: number } };
    menuView: {
        /** A separator is a plain view: no `childView`, which is how the walker tells it apart. */
        items: Array<{ childView?: MenuButtonView | NestedMenuView }>;
        buttons: MenuButtonView[];
        menus: NestedMenuView[];
    };
}

/** What a target with nothing around it in the note sends. */
const NO_SURROUNDINGS = { before: "", after: "" };

const QUICK_ACTIONS: AiQuickActionGroup[] = [
    {
        id: "edit",
        label: "Edit or review",
        actions: [
            { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
            { id: "makeShorter", label: "Make shorter", prompt: "Shorten it." }
        ]
    },
    {
        id: "generate",
        label: "Generate",
        actions: [
            { id: "write", label: "Write something", prompt: "Write a paragraph.", requiresContent: false }
        ]
    },
    {
        id: "tone",
        label: "Change tone",
        submenu: true,
        iconClass: "bx bx-palette",
        actions: [
            { id: "direct", label: "Direct", commandLabel: "Make it direct", prompt: "Make it direct.", iconClass: "bx bx-target-lock" },
            { id: "friendly", label: "Friendly", prompt: "Make it friendly." }
        ]
    },
    {
        id: "translate",
        label: "Translate",
        submenu: true,
        iconClass: "bx bx-globe",
        actions: [
            { id: "romanian", label: "Romanian", commandLabel: "Translate to Romanian", prompt: "Translate it." }
        ]
    }
];

/**
 * The plugin requires a host sanitizer and refuses to render without one; the tests assert on the
 * HTML they feed in, so the double passes it through untouched.
 */
const sanitizeHtml = (html: string) => html;

/**
 * The requests handed to the stream, in order, plus the stub itself.
 *
 * @param source what a host that renders its responses would report the HTML was rendered from —
 *               omitted by one that streams HTML outright, which is delivered as its own source.
 */
function createStreamStub(response = "<p>done</p>", source?: string) {
    const requests: AiCompletionRequest[] = [];
    const stream: AiStreamFunction = async (request: AiCompletionRequest, onData: AiStreamCallback) => {
        requests.push(request);
        onData(response, source);
    };
    return { requests, stream };
}

async function createEditor(quickActions?: AiQuickActionGroup[], stream?: AiStreamFunction) {
    return createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
        aiAssistant: { stream, quickActions, sanitizeHtml }
    });
}

function createComponent(editor: ClassicEditor) {
    return editor.ui.componentFactory.create("aiAssistant") as unknown as QuickActionsDropdown;
}

/** Opens the dropdown — `addMenuToDropdown` only builds the menu on the first open. */
function openMenu(dropdown: QuickActionsDropdown): QuickActionsDropdown["menuView"] {
    dropdown.isOpen = true;
    return dropdown.menuView;
}

/**
 * What the menu offers at its top level: an inlined action reads as its label, a submenu as its
 * label plus the labels it holds.
 */
function menuEntries(dropdown: QuickActionsDropdown): Array<string | { menu: string; actions: string[] }> {
    return openMenu(dropdown).items.map(({ childView }) => {
        if (!childView) {
            return "---";
        }
        return "listView" in childView
            ? {
                menu: childView.buttonView.label ?? "",
                actions: childView.listView.items.map((item) => item.childView?.label ?? "---")
            }
            : childView.label ?? "";
    });
}

/**
 * Every action button, submenus included, in definition order — without the row that heads the
 * menu, which opens the assistant rather than running anything.
 */
function quickActionButtons(dropdown: QuickActionsDropdown): MenuButtonView[] {
    return openMenu(dropdown).buttons.filter((button) => button.id !== "__ask");
}

/** What the dialog's header currently reads. */
function dialogTitle(editor: ClassicEditor) {
    return editor.plugins.get(Dialog).view?.headerView?.label;
}

/** The form the assistant put into the dialog, once it is open. */
function openForm(editor: ClassicEditor) {
    return editor.plugins.get(Dialog).view?.contentView?.children.get(0) as unknown as {
        query: string;
        phase: string;
        viewMode: string;
        hasDiff: boolean;
        isUnchanged: boolean;
        usageText: string;
        errorMessage: string;
        previewView: { element?: HTMLElement | null };
        hasPicker: boolean;
        pickerView: {
            isOpen: boolean;
            isEnabled: boolean;
            buttonView: { label?: string; tooltip?: string | boolean };
            listView?: { items: Iterable<PickerListItem> };
        };
        fire(event: string): void;
    };
}

/**
 * A row of the dialog's picker, or the group heading one opens: a group carries its own `label` and
 * holds its rows in `items`, while a plain row wraps its button in `children`.
 */
interface PickerListItem {
    label?: string;
    items?: Iterable<PickerListItem>;
    children?: { first?: PickerButton | null };
}

interface PickerButton {
    label?: string;
    isOn?: boolean;
    fire(event: string): void;
}

/** The picker's rows, flattened out of their groups, each paired with the heading it sits under. */
function pickerRows(form: ReturnType<typeof openForm>): Array<[string, string, boolean]> {
    return [ ...(form.pickerView.listView?.items ?? []) ].flatMap((item) => (item.items
        ? [ ...item.items ].map((row) => [item.label ?? "", row.children?.first?.label ?? "", !!row.children?.first?.isOn] as [string, string, boolean])
        : [["", item.children?.first?.label ?? "", !!item.children?.first?.isOn] as [string, string, boolean]]));
}

/** What the preview currently holds, for the specs that assert on rendered content. */
function previewHtml(editor: ClassicEditor): string {
    return openForm(editor).previewView.element?.innerHTML ?? "";
}

describe("AiAssistantUI toolbar entry", () => {
    it("is a plain button when the host configured no quick actions", async () => {
        const editor = await createEditor(undefined, createStreamStub().stream);
        const button = editor.ui.componentFactory.create("aiAssistant") as ButtonView;
        const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

        expect(button).toBeInstanceOf(ButtonView);
        expect(button.label).toBe("AI assistant");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(showSpy).toHaveBeenCalled();
    });

    // The feature has to be reachable without leaving the text being written, and the toolbar
    // tooltip is where a keystroke is discovered.
    describe("the keystroke", () => {
        /** Presses Ctrl+Shift+K on the editor, reporting whether the editor took the key. */
        function press(editor: ClassicEditor): boolean {
            const preventDefault = vi.fn();
            const keyEvtData = {
                keyCode: keyCodes.k,
                ctrlKey: true,
                shiftKey: true,
                altKey: false,
                metaKey: false,
                preventDefault,
                stopPropagation: vi.fn()
            };

            editor.keystrokes.press(keyEvtData);
            // What `cancel()` does, so this says whether the editor took the key or let it through.
            return preventDefault.mock.calls.length > 0;
        }

        it("opens the assistant, and says so on the toolbar entry", async () => {
            const editor = await createEditor(QUICK_ACTIONS, createStreamStub().stream);
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

            expect(press(editor)).toBe(true);
            expect(showSpy).toHaveBeenCalled();

            // The action half of the split button, which is the half the keystroke stands for.
            expect(createComponent(editor).buttonView.keystroke).toBe("Ctrl+Shift+K");
            const plain = (await createEditor(undefined, createStreamStub().stream))
                .ui.componentFactory.create("aiAssistant") as ButtonView;
            expect(plain.keystroke).toBe("Ctrl+Shift+K");
        });

        it("lets the key through when no LLM provider is configured", async () => {
            // Swallowing it would cost the user a keystroke to a feature that cannot run.
            const editor = await createEditor(QUICK_ACTIONS);
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

            expect(press(editor)).toBe(false);
            expect(showSpy).not.toHaveBeenCalled();
        });
    });

    describe("with quick actions configured", () => {
        let editor: ClassicEditor;
        let dropdown: QuickActionsDropdown;
        let requests: AiCompletionRequest[];

        beforeEach(async () => {
            const stub = createStreamStub();
            requests = stub.requests;
            editor = await createEditor(QUICK_ACTIONS, stub.stream);
            dropdown = createComponent(editor);
        });

        it("is a split button whose action opens the assistant", () => {
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");

            expect(dropdown.buttonView).toBeInstanceOf(SplitButtonView);
            expect(dropdown.buttonView.label).toBe("AI assistant");
            expect(dropdown.buttonView.icon).toContain("<svg");

            dropdown.buttonView.fire("execute");
            expect(showSpy).toHaveBeenCalled();
        });

        it("inlines an ordinary group and gives a `submenu` one its own menu", () => {
            // An inlined group loses its heading — its actions already read as commands, and the
            // menu definition has no room for a heading. A submenu keeps its label as the entry.
            expect(menuEntries(dropdown)).toEqual([
                // The way in the button half offers, for the menu — a prompt rather than an
                // instruction, so it heads the menu behind a rule of its own.
                "Ask AI…",
                "---",
                "Fix typos",
                "Make shorter",
                "---",
                "Write something",
                "---",
                { menu: "Change tone", actions: ["Direct", "Friendly"] },
                { menu: "Translate", actions: ["Romanian"] }
            ]);
        });

        // A rule between blocks, and none between two openers: without the headings the menu
        // definition cannot carry, the separator is what marks where a set of actions ends.
        it("heads the menu with the way in the button half offers", () => {
            const showSpy = vi.spyOn(editor.plugins.get(AiAssistantUI), "show");
            const [ask] = openMenu(dropdown).buttons;

            expect(ask.id).toBe("__ask");
            expect(ask.label).toBe("Ask AI…");

            // A prompt is typed against whatever is there, so unlike an instruction about content
            // this row does not go inert when there is none.
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(ask.isEnabled).toBe(true);

            ask.fire("execute");
            expect(showSpy).toHaveBeenCalled();
        });

        it("rules off each block but not between adjacent submenus", () => {
            const entries = menuEntries(dropdown);
            // One under the prompt row, then one per group boundary that is not between submenus.
            expect(entries.filter((entry) => entry === "---")).toHaveLength(3);
            expect(entries.at(-1)).toEqual({ menu: "Translate", actions: ["Romanian"] });
        });

        // The menu definition has no icon field, so the glyphs are hung on the views CKEditor
        // built — on an item inside a submenu as much as on an inlined one.
        it("renders an icon-pack glyph for the actions and submenus that have one", () => {
            const direct = quickActionButtons(dropdown).find((button) => button.id === "direct");
            expect(direct?.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-target-lock");

            const [tone] = openMenu(dropdown).items
                .map(({ childView }) => childView)
                .filter((childView): childView is NestedMenuView => !!childView && "listView" in childView);
            expect(tone.buttonView.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-palette");
        });

        it("leaves an action without an icon alone", () => {
            const friendly = quickActionButtons(dropdown).find((button) => button.id === "friendly");
            expect(friendly?.element?.querySelector(".ck-ai-action-icon")).toBeNull();
        });

        it("gates a submenu on the content its actions need", () => {
            const [tone] = openMenu(dropdown).menus;

            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(tone.isEnabled).toBe(false);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            expect(tone.isEnabled).toBe(true);
        });

        it("gates the content-requiring actions on there being something to work on", () => {
            const [fixTypos, , write, direct] = quickActionButtons(dropdown);

            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(false);
            expect(write.isEnabled).toBe(true);
            // Gating reaches into the submenus too, not just the inlined actions.
            expect(direct.isEnabled).toBe(false);

            // A collapsed caret is enough as long as its block has content: that is what the run
            // falls back to.
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            expect(fixTypos.isEnabled).toBe(true);
        });

        it("leaves a submenu alone when one of its actions runs without content", async () => {
            const editorWithFreeAction = await createEditor([{
                id: "generate",
                label: "Generate",
                submenu: true,
                actions: [
                    { id: "write", label: "Write something", prompt: "Write.", requiresContent: false },
                    { id: "rewrite", label: "Rewrite", prompt: "Rewrite." }
                ]
            }], createStreamStub().stream);
            const [generate] = openMenu(createComponent(editorWithFreeAction)).menus;

            setModelData(editorWithFreeAction.model, "<paragraph>[]</paragraph>");
            expect(generate.isEnabled).toBe(true);
        });

        // A group whose contents the host lets the user choose ends with the row that chooses them,
        // which is not an action: no prompt, nothing to work on, and nothing for the model to do.
        it("closes a group's submenu with its footer, below a rule and reachable without content", async () => {
            const run = vi.fn();
            const stub = createStreamStub();
            const editorWithFooter = await createEditor([{
                id: "translate",
                label: "Translate",
                submenu: true,
                actions: [{ id: "german", label: "German", prompt: "Translate to German." }],
                footer: { label: "Configure languages…", iconClass: "bx bx-cog", run }
            }], stub.stream);
            const dropdownWithFooter = createComponent(editorWithFooter);
            const [translate] = openMenu(dropdownWithFooter).menus;

            expect(translate.listView.items.map((item) => item.childView?.label ?? "---"))
                .toEqual(["German", "---", "Configure languages…"]);

            // Its one action needs content; the footer does not, so neither the row nor the submenu
            // holding it closes off with nothing selected.
            setModelData(editorWithFooter.model, "<paragraph>[]</paragraph>");
            expect(translate.isEnabled).toBe(true);

            const configure = quickActionButtons(dropdownWithFooter)
                .find((button) => button.id === "translate:footer");
            expect(configure?.isEnabled).toBe(true);
            expect(configure?.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-cog");

            configure?.fire("execute");
            expect(run).toHaveBeenCalled();
            // It runs host code instead of the assistant: no request, and no dialog.
            expect(stub.requests).toHaveLength(0);
            expect(editorWithFooter.plugins.get(Dialog).id).toBeNull();
        });

        // The Translate group lists the enabled content languages, which the footer above lets the
        // user change from inside the editor — so the menu has to be able to say something new
        // without the editor being torn down and rebuilt, which would cost the caret and the undo
        // history of the note being written.
        it("redraws the menu when the quick actions are replaced on a live editor", async () => {
            expect(menuEntries(dropdown)).toContainEqual({ menu: "Translate", actions: ["Romanian"] });

            editor.plugins.get(AiAssistantUI).updateQuickActions([{
                id: "translate",
                label: "Translate",
                submenu: true,
                actions: [
                    { id: "german", label: "German", prompt: "Translate to German." },
                    { id: "japanese", label: "Japanese", prompt: "Translate to Japanese." }
                ]
            }]);

            // Redrawn on the way open, so it is still the old menu until the dropdown is reopened.
            dropdown.isOpen = false;
            dropdown.isOpen = true;
            expect(menuEntries(dropdown)).toEqual([
                "Ask AI…",
                "---",
                { menu: "Translate", actions: ["German", "Japanese"] }
            ]);

            // The menu the redraw replaced is gone rather than left beside its successor.
            expect(dropdown.panelView.children.length).toBe(1);

            // A button from the new draw still reaches the assistant, so the execute lookup was
            // refilled along with the views.
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(dropdown).find((button) => button.id === "japanese")?.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));
            expect(requests[0]).toEqual({ query: "Translate to Japanese.", context: "foo", surroundings: NO_SURROUNDINGS, history: [] });
        });

        // What a run answers to rather than an instruction for one — Trilium hangs the model picker
        // here — so it closes the menu below a rule and never asks whether there is content.
        it("closes the menu with its footer rows, and opens the ones that hold others", async () => {
            const run = vi.fn();
            editor.plugins.get(AiAssistantUI).updateMenuFooter([{
                label: "Model: Sonnet 5",
                iconClass: "bx bx-chip",
                children: [
                    { label: "Sonnet 5", iconClass: "bx bx-check", run },
                    { label: "Opus 5", iconClass: "bx bx-empty", run: vi.fn() }
                ]
            }]);

            dropdown.isOpen = false;
            dropdown.isOpen = true;
            const entries = menuEntries(dropdown);
            expect(entries.at(-1)).toEqual({ menu: "Model: Sonnet 5", actions: ["Sonnet 5", "Opus 5"] });
            expect(entries.at(-2)).toBe("---");

            const [picker] = openMenu(dropdown).menus.filter((menu) => menu.id.startsWith("__footer"));
            expect(picker.buttonView.element?.querySelector(".ck-ai-action-icon")?.className)
                .toBe("ck-ai-action-icon bx bx-chip");

            // Nothing is selected, yet the picker and its rows stay reachable.
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(picker.isEnabled).toBe(true);

            const sonnet = quickActionButtons(dropdown).find((button) => button.label === "Sonnet 5");
            expect(sonnet?.isEnabled).toBe(true);
            sonnet?.fire("execute");
            expect(run).toHaveBeenCalled();
            expect(requests).toHaveLength(0);
        });

        // A list long enough to want dividing says what divides it. The menu definition carries
        // buttons and submenus and nothing else, so the headings are put in beside the rows.
        it("heads the blocks of a footer submenu that asked for headings", () => {
            editor.plugins.get(AiAssistantUI).updateMenuFooter([{
                label: "Model: Sonnet 5",
                children: [
                    { label: "Sonnet 5", heading: "Anthropic", run: vi.fn() },
                    { label: "Opus 5", run: vi.fn() },
                    { label: "GPT-5", heading: "OpenAI", run: vi.fn() }
                ]
            }]);

            dropdown.isOpen = false;
            dropdown.isOpen = true;
            const [picker] = openMenu(dropdown).menus.filter((menu) => menu.id.startsWith("__footer"));

            // A heading is a plain view beside the rows, so it reads as a gap in the button list.
            expect(picker.listView.items.map((item) => item.childView?.label ?? "---"))
                .toEqual(["---", "Sonnet 5", "Opus 5", "---", "GPT-5"]);
            expect([ ...picker.listView.items ].flatMap((item) =>
                (item.childView ? [] : [(item as unknown as { element?: HTMLElement }).element?.textContent])))
                .toEqual(["Anthropic", "OpenAI"]);
        });

        // The menu can only be reached before anything opens; the dialog stays open across a
        // follow-up and a retry, which is when the setting is actually worth changing.
        it("offers the same setting beside the prompt, grouped and ticked by the picker's own list", () => {
            const run = vi.fn();
            editor.plugins.get(AiAssistantUI).updateMenuFooter([{
                label: "Model: Sonnet 5",
                children: [
                    { label: "Sonnet 5", heading: "Anthropic", isCurrent: true, run: vi.fn() },
                    { label: "Opus 5", run },
                    { label: "GPT-5", heading: "OpenAI", run: vi.fn() }
                ]
            }]);

            editor.execute("aiAssistant");
            const form = openForm(editor);
            expect(form.hasPicker).toBe(true);

            // The button names what is in force, not the setting — the setting's name is the tooltip.
            expect(form.pickerView.buttonView.label).toBe("Sonnet 5");
            expect(form.pickerView.buttonView.tooltip).toBe("Model: Sonnet 5");

            // A heading opens a group and the rows after it belong to it — CKEditor's own list
            // groups, with the tick and the column reserving it theirs too, rather than the
            // headings and the empty icons the menu has to supply by hand.
            form.pickerView.isOpen = true;
            expect(pickerRows(form)).toEqual([
                ["Anthropic", "Sonnet 5", true],
                ["Anthropic", "Opus 5", false],
                ["OpenAI", "GPT-5", false]
            ]);
        });

        it("closes the dialog's picker once a choice is made, and runs it", () => {
            const run = vi.fn();
            editor.plugins.get(AiAssistantUI).updateMenuFooter([{
                label: "Model: Sonnet 5",
                children: [{ label: "Opus 5", run }]
            }]);

            editor.execute("aiAssistant");
            const form = openForm(editor);
            form.pickerView.isOpen = true;
            [ ...(form.pickerView.listView?.items ?? []) ][0].children?.first?.fire("execute");

            expect(run).toHaveBeenCalled();
            expect(form.pickerView.isOpen).toBe(false);
            expect(requests).toHaveLength(0);
        });

        it("keeps the prompt row bare when the host offers no setting", () => {
            editor.execute("aiAssistant");
            expect(openForm(editor).hasPicker).toBe(false);
        });

        it("runs an action picked from inside a submenu", async () => {
            // A submenu button delegates its `execute` up through its menu to the root rather than
            // firing on the dropdown itself, so this is a different path from an inlined action.
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const direct = quickActionButtons(dropdown).find((button) => button.id === "direct");

            direct?.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Make it direct.", context: "foo", surroundings: NO_SURROUNDINGS, history: [] });
        });

        it("falls back to the caret's block when nothing is selected", async () => {
            setModelData(editor.model, "<paragraph>first</paragraph><paragraph>seco[]nd</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Fix all mistakes.", context: "second", surroundings: { before: "first", after: "" }, history: [] });
        });

        it("keeps a free-form prompt at a collapsed caret generating from scratch", async () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.execute("aiAssistant");

            const form = openForm(editor);
            form.query = "Write a haiku.";
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Write a haiku.", context: "", surroundings: { before: "foo", after: "" }, history: [] });
        });

        it("runs the picked action against the selection and opens the dialog on it", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            expect(requests[0]).toEqual({ query: "Fix all mistakes.", context: "foo", surroundings: NO_SURROUNDINGS, history: [] });

            const dialog = editor.plugins.get(Dialog);
            expect(dialog.isOpen).toBe(true);
            expect(dialog.id).toBe("aiAssistant");
        });

        it("hands the pinned range back as the selection when dismissed", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            editor.execute("aiAssistant");

            // The marker, not the selection, is what shows the target while the dialog stands.
            expect(editor.model.markers.has("triliumAiTarget")).toBe(true);

            // Whatever becomes of the selection meanwhile — the editable is blurred for the
            // dialog's whole life, so nothing is holding it in place.
            const start = editor.model.document.selection.getFirstPosition();
            if (start) {
                editor.model.change((writer) => writer.setSelection(start));
            }
            expect(getModelData(editor.model)).toBe("<paragraph>[]foo</paragraph>");

            editor.plugins.get(Dialog).hide();

            expect(editor.model.markers.has("triliumAiTarget")).toBe(false);
            expect(getModelData(editor.model)).toBe("<paragraph>[foo]</paragraph>");
        });

        it("leaves the selection to the insertion when the response is committed", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));

            openForm(editor).fire("replace");

            // A commit places the selection itself; the pinned range it wrote over must not be
            // restored over the top of that, which would leave the insertion selected.
            expect(editor.model.markers.has("triliumAiTarget")).toBe(false);
            expect(getModelData(editor.model)).toBe("<paragraph>[]done</paragraph>");
        });

        it("titles the dialog with the action it is running, as the palette names it", async () => {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            const [fixTypos, , , direct] = quickActionButtons(dropdown);

            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));
            expect(dialogTitle(editor)).toBe("Fix typos");

            // A submenu's label can be a fragment ("Direct"), so an action may carry a standalone
            // phrasing for the places that show it away from its group.
            direct.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(2));
            expect(dialogTitle(editor)).toBe("Make it direct");

            // A typed follow-up is no longer that action.
            const form = openForm(editor);
            form.query = "now make it shorter";
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(3));
            expect(dialogTitle(editor)).toBe("AI assistant");
        });

        it("closes itself off while a run is in flight", async () => {
            let release = () => {};
            const editorWithSlowStream = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: {
                    sanitizeHtml,
                    quickActions: QUICK_ACTIONS,
                    stream: () => new Promise<void>((resolve) => {
                        release = resolve;
                    })
                }
            });
            const slowDropdown = createComponent(editorWithSlowStream);

            setModelData(editorWithSlowStream.model, "<paragraph>[foo]</paragraph>");
            expect(slowDropdown.isEnabled).toBe(true);

            const [fixTypos] = quickActionButtons(slowDropdown);
            fixTypos.fire("execute");

            await vi.waitFor(() => expect(slowDropdown.isEnabled).toBe(false));
            release();
            await vi.waitFor(() => expect(slowDropdown.isEnabled).toBe(true));
        });
    });

    // A selection says nothing about where in the note it sits, and "continue this" or "summarize
    // this" read differently under a heading than they do in an opening paragraph.
    describe("the note around the target", () => {
        let editor: ClassicEditor;
        let dropdown: QuickActionsDropdown;
        let requests: AiCompletionRequest[];

        beforeEach(async () => {
            const stub = createStreamStub();
            requests = stub.requests;
            editor = await createEditor(QUICK_ACTIONS, stub.stream);
            dropdown = createComponent(editor);
        });

        /** Runs the first quick action and hands back what it sent as the target's surroundings. */
        async function surroundingsOf(data: string) {
            const expected = requests.length + 1;
            setModelData(editor.model, data);
            quickActionButtons(dropdown)[0].fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(expected));
            return requests[expected - 1].surroundings;
        }

        it("sends the text either side of it, one line per block", async () => {
            expect(await surroundingsOf([
                "<paragraph>A heading</paragraph>",
                "<paragraph>Before it</paragraph>",
                "<paragraph>[the target]</paragraph>",
                "<paragraph>After it</paragraph>"
            ].join(""))).toEqual({ before: "A heading\nBefore it", after: "After it" });
        });

        it("splits at the caret when there is no selection to work on", async () => {
            // The quick action widens a collapsed caret to its block, so the block being rewritten
            // is the target and belongs to neither side.
            expect(await surroundingsOf("<paragraph>one</paragraph><paragraph>t[]wo</paragraph><paragraph>three</paragraph>"))
                .toEqual({ before: "one", after: "three" });
        });

        it("sends nothing around a target that is the whole note", async () => {
            expect(await surroundingsOf("<paragraph>[all of it]</paragraph>")).toEqual(NO_SURROUNDINGS);
        });

        it("keeps the end nearest the target when the note is longer than the limit", async () => {
            // Numbered lines of a hundred characters each, so that only the last dozen or so of
            // the forty either side can fit in what a run sends.
            const line = (marker: string, index: number) => `${marker}${index}`.padEnd(100, ".");
            const filler = (marker: string) => Array.from({ length: 40 },
                (_, index) => `<paragraph>${line(marker, index)}</paragraph>`).join("");

            const { before, after } = await surroundingsOf(
                `${filler("b")}<paragraph>[the target]</paragraph>${filler("a")}`);

            // Whole lines only, and the ones closest to the target: the paragraph just above the
            // selection says far more about it than the note's first one does.
            expect(before.split("\n").at(-1)).toBe(line("b", 39));
            expect(before).not.toContain(line("b", 0));
            expect(after.split("\n").at(0)).toBe(line("a", 0));
            expect(after).not.toContain(line("a", 39));
            for (const side of [before, after]) {
                expect(side.length).toBeLessThanOrEqual(1500);
                expect(side.split("\n").every((entry) => /^[ab]\d+\.*$/.test(entry))).toBe(true);
            }
        });

        it("stays with the conversation it was captured for, and goes when it closes", async () => {
            await surroundingsOf("<paragraph>one</paragraph><paragraph>[two]</paragraph>");

            const form = openForm(editor);
            form.query = "now make it shorter";
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(2));
            expect(requests[1].surroundings).toEqual({ before: "one", after: "" });

            editor.plugins.get(Dialog).hide();
            expect(await surroundingsOf("<paragraph>[nothing around it]</paragraph>")).toEqual(NO_SURROUNDINGS);
        });
    });

    // A follow-up is a turn in a conversation rather than a fresh instruction about the last
    // answer: asked to translate and then to shorten, the model has to still see that the first
    // instruction was German, or it shortens the German back into English.
    describe("the conversation a follow-up continues", () => {
        let editor: ClassicEditor;
        let dropdown: QuickActionsDropdown;
        let requests: AiCompletionRequest[];

        beforeEach(async () => {
            // A host that renders its responses reports what it rendered them from, and that is
            // what the conversation records — the model gets its own words back, not our HTML.
            const stub = createStreamStub("<p>Guten Tag</p>", "Guten Tag");
            requests = stub.requests;
            editor = await createEditor(QUICK_ACTIONS, stub.stream);
            dropdown = createComponent(editor);
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
        });

        /** Runs the first quick action, which is how every conversation here is opened. */
        async function open() {
            const [fixTypos] = quickActionButtons(dropdown);
            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(1));
            return fixTypos;
        }

        /** Types a follow-up into the standing dialog and waits for the run it starts. */
        async function followUp(query: string, expected: number) {
            const form = openForm(editor);
            form.query = query;
            form.fire("submit");
            await vi.waitFor(() => expect(requests).toHaveLength(expected));
        }

        it("carries every exchange so far, against the content it opened on", async () => {
            await open();
            await followUp("now make it shorter", 2);

            expect(requests[1]).toEqual({
                query: "now make it shorter",
                // The selection, still: what has been said about it is on the record instead of
                // being restated as the thing to work on.
                context: "foo",
                surroundings: NO_SURROUNDINGS,
                history: [
                    { role: "user", content: "Fix all mistakes." },
                    { role: "assistant", content: "Guten Tag" }
                ]
            });

            await followUp("and in bullet points", 3);
            expect(requests[2].history).toHaveLength(4);
            expect(requests[2].history.at(-2)).toEqual({ role: "user", content: "now make it shorter" });
        });

        it("keeps a quick action picked over the open assistant in the same conversation", async () => {
            await open();
            const [, makeShorter] = quickActionButtons(dropdown);

            makeShorter.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(2));

            expect(requests[1].query).toBe("Shorten it.");
            expect(requests[1].history).toEqual([
                { role: "user", content: "Fix all mistakes." },
                { role: "assistant", content: "Guten Tag" }
            ]);
        });

        it("drops the exchange a retry replaces", async () => {
            await open();
            await followUp("now make it shorter", 2);

            openForm(editor).fire("tryAgain");
            await vi.waitFor(() => expect(requests).toHaveLength(3));

            // The retry asks the same question of the same conversation: the answer it is
            // replacing is gone from the transcript, or the model would be refining it again.
            expect(requests[2]).toEqual(requests[1]);
        });

        it("opens a fresh conversation each time the assistant does", async () => {
            const fixTypos = await open();

            editor.plugins.get(Dialog).hide();
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            fixTypos.fire("execute");
            await vi.waitFor(() => expect(requests).toHaveLength(2));

            expect(requests[1]).toEqual({ query: "Fix all mistakes.", context: "bar", surroundings: NO_SURROUNDINGS, history: [] });
        });

        it("records the delivered HTML for a host that reports no source", async () => {
            const stub = createStreamStub("<p>done</p>");
            const htmlEditor = await createEditor(QUICK_ACTIONS, stub.stream);
            const htmlDropdown = createComponent(htmlEditor);

            setModelData(htmlEditor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(htmlDropdown)[0].fire("execute");
            await vi.waitFor(() => expect(stub.requests).toHaveLength(1));

            const form = openForm(htmlEditor);
            form.query = "now make it shorter";
            form.fire("submit");
            await vi.waitFor(() => expect(stub.requests).toHaveLength(2));

            expect(stub.requests[1].history.at(-1)).toEqual({ role: "assistant", content: "<p>done</p>" });
        });
    });

    describe("the view a finished review opens on", () => {
        const REVIEW_ACTIONS: AiQuickActionGroup[] = [
            {
                id: "edit",
                label: "Edit or review",
                actions: [
                    { id: "fixTypos", label: "Fix typos", prompt: "Fix all mistakes." },
                    // A replacement by definition, whatever the diff makes of it.
                    { id: "translate", label: "Translate", prompt: "Translate it.", reviewView: "result" }
                ]
            }
        ];

        /** Runs one quick action against a selection and hands back the form in its review. */
        async function review(diff: AiDiffFunction, actionId: string) {
            const stub = createStreamStub();
            const editor = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: REVIEW_ACTIONS, stream: stub.stream, diff }
            });
            const dropdown = createComponent(editor);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(dropdown).find((button) => button.id === actionId)?.fire("execute");
            await vi.waitFor(() => expect(stub.requests).toHaveLength(1));

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            return form;
        }

        it("is the changes by default, and the result for an action that asks for it", async () => {
            const diff = () => "<ins>done</ins>";

            expect((await review(diff, "fixTypos")).viewMode).toBe("changes");
            expect((await review(diff, "translate")).viewMode).toBe("result");
        });

        it("withholds the diff of a response the differ reports as unchanged", async () => {
            const form = await review(() => ({ html: "<p>done</p>", isUnchanged: true }), "fixTypos");

            // The form says so in words; a diff with no marks in it reads as a diff that failed.
            expect(form.isUnchanged).toBe(true);
            expect(form.hasDiff).toBe(false);
            expect(form.viewMode).toBe("result");
        });

        it("is the result when the diff reports the response as mostly a rewrite", async () => {
            // The same call the differ makes for a response it could not align with its source.
            const form = await review(() => ({ html: "<ins>done</ins>", rewriteRatio: 1 }), "fixTypos");

            expect(form.viewMode).toBe("result");
            // Still offered, only not opened on.
            expect(form.hasDiff).toBe(true);
        });
    });

    // A diagram is a `language-mermaid` code block until the content is upcast into the model,
    // which the assistant only does on commit — so the preview has to render it itself, or the
    // Diagram quick action reviews its own source and the diagram only appears once accepted.
    describe("Mermaid diagrams in the preview", () => {
        const DIAGRAM = "graph TD; A-->B;";
        const DIAGRAM_HTML = `<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>`;

        const DIAGRAM_ACTION: AiQuickActionGroup[] = [{
            id: "reformat",
            label: "Reformat",
            actions: [{ id: "diagram", label: "Diagram", prompt: "Draw it.", reviewView: "result" }]
        }];

        /** Stands in for the mermaid library the host lazy-loads, one SVG per source. */
        function createMermaidStub() {
            return {
                initialize: vi.fn(),
                render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-source="${source}"></svg>` }))
            };
        }

        async function createDiagramEditor(mermaid: ReturnType<typeof createMermaidStub>, stream: AiStreamFunction) {
            return createTestEditor([Essentials, Paragraph, CodeBlockEditing, MermaidEditing, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: DIAGRAM_ACTION, stream },
                mermaid: { lazyLoad: () => mermaid, config: {} }
            });
        }

        it("renders the diagram a finished response holds, in place of its code block", async () => {
            const mermaid = createMermaidStub();
            const stub = createStreamStub(DIAGRAM_HTML);
            const editor = await createDiagramEditor(mermaid, stub.stream);

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            await vi.waitFor(() => expect(previewHtml(editor)).toContain("<svg"));
            expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), DIAGRAM);
            // The `<pre>` goes with the `<code>`: what is left is the diagram, not a framed one.
            expect(previewHtml(editor))
                .toContain(`<div class="ck-ai-assistant-form__diagram"><svg data-source="graph TD; A--&gt;B;">`);
            expect(previewHtml(editor)).not.toContain("<pre>");

            // Nothing was done to the response itself — the note gets the code block, which the
            // editor upcasts into a diagram widget of its own.
            openForm(editor).fire("replace");
            expect(editor.getData()).toContain(`<code class="language-mermaid">`);
        });

        it("leaves a half-streamed diagram as its source", async () => {
            const mermaid = createMermaidStub();
            const editor = await createDiagramEditor(mermaid, async (_request, onData) => {
                onData(`<pre><code class="language-mermaid">graph TD; A--</code></pre>`);
                await new Promise(() => {});
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            // Parsing a fragment would put a parse error where the diagram is about to be, once
            // per streamed chunk. The source stands until the response is complete.
            await vi.waitFor(() => expect(previewHtml(editor)).toContain("language-mermaid"));
            expect(mermaid.render).not.toHaveBeenCalled();
        });

        // The library is the host's to supply (`config.mermaid.lazyLoad`), so the feature can be
        // loaded with nothing behind it. Emptying the block for a diagram that will never arrive
        // would lose the response; the source is at least what a commit would produce.
        it("leaves the source standing when the host supplies no diagram library", async () => {
            const stub = createStreamStub(DIAGRAM_HTML);
            const editor = await createTestEditor([Essentials, Paragraph, CodeBlockEditing, MermaidEditing, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: DIAGRAM_ACTION, stream: stub.stream }
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            await vi.waitFor(() => expect(openForm(editor).phase).toBe("review"));
            expect(previewHtml(editor)).toBe(DIAGRAM_HTML);
        });

        it("leaves the code block alone in the diff, whose text is two responses at once", async () => {
            const mermaid = createMermaidStub();
            const stub = createStreamStub(DIAGRAM_HTML);
            const editor = await createTestEditor([Essentials, Paragraph, CodeBlockEditing, MermaidEditing, TriliumAiAssistant], {
                aiAssistant: {
                    sanitizeHtml,
                    quickActions: DIAGRAM_ACTION,
                    stream: stub.stream,
                    // Opens on the diff, since the action asking for the result is not the one run.
                    diff: () => `<pre><code class="language-mermaid">graph <del>LR</del><ins>TD</ins></code></pre>`
                },
                mermaid: { lazyLoad: () => mermaid, config: {} }
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            editor.execute("aiAssistant");
            const form = openForm(editor);
            form.query = "Draw it.";
            form.fire("submit");

            await vi.waitFor(() => expect(form.viewMode).toBe("changes"));
            expect(mermaid.render).not.toHaveBeenCalled();
            expect(previewHtml(editor)).toContain("<del>LR</del>");

            // The toggle back to the result is a render of its own, so the diagram lands there.
            form.viewMode = "result";
            await vi.waitFor(() => expect(previewHtml(editor)).toContain("<svg"));
        });
    });

    // An equation reaches the preview as its own LaTeX source, inside the `math-tex` span note HTML
    // stores it in — so a review of one used to read `\(c^2 = a^2 + b^2\)` where the note shows it
    // set. Same shape as the diagrams above: the editor only typesets on upcast.
    describe("equations in the preview", () => {
        const MATH_ACTION: AiQuickActionGroup[] = [{
            id: "edit",
            label: "Edit or review",
            actions: [{ id: "explain", label: "Explain", prompt: "Explain it.", reviewView: "result" }]
        }];

        /**
         * The typesetting engine, as the host's own function rather than KaTeX: `config.math.engine`
         * takes one, which keeps the assertions about what the assistant asks for — the equation
         * without its delimiters, and whether it is display maths.
         */
        function createEngineStub() {
            return vi.fn((equation: string, element: HTMLElement, display: boolean) => {
                element.textContent = `[${display ? "display" : "inline"}:${equation}]`;
            });
        }

        async function createMathEditor(response: string, engine?: ReturnType<typeof createEngineStub>) {
            return createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: MATH_ACTION, stream: createStreamStub(response).stream },
                ...(engine ? { math: { engine } } : {})
            });
        }

        async function review(editor: ClassicEditor) {
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");
            await vi.waitFor(() => expect(openForm(editor).phase).toBe("review"));
        }

        it("typesets the equations a finished response holds, inline and display alike", async () => {
            const engine = createEngineStub();
            const editor = await createMathEditor(
                String.raw`<p>so <span class="math-tex">\(c^2 = a^2 + b^2\)</span></p>`
                + String.raw`<span class="math-tex">\[e^{i\pi} = -1\]</span>`,
                engine
            );

            await review(editor);
            await vi.waitFor(() => expect(previewHtml(editor)).toContain("["));

            // The delimiters are the span's, not the equation's: the engine is handed the source
            // alone, and told from which pair it came whether to set it as display maths.
            expect(engine.mock.calls.map(([equation, , display]) => [equation, display])).toEqual([
                ["c^2 = a^2 + b^2", false],
                ["e^{i\\pi} = -1", true]
            ]);
            expect(previewHtml(editor)).toContain(`<span class="math-tex">[inline:c^2 = a^2 + b^2]</span>`);
            expect(previewHtml(editor)).toContain(`<span class="math-tex">[display:e^{i\\pi} = -1]</span>`);

            // The response itself is untouched, so the note is given the source the editor upcasts
            // into equations of its own.
            openForm(editor).fire("replace");
            expect(editor.getData()).toContain(String.raw`\(c^2 = a^2 + b^2\)`);
        });

        it("leaves the source standing when the host configured no maths", async () => {
            const html = String.raw`<p><span class="math-tex">\(x^2\)</span></p>`;
            const editor = await createMathEditor(html);

            await review(editor);
            expect(previewHtml(editor)).toBe(html);
        });

        it("leaves a half-streamed equation alone", async () => {
            const engine = createEngineStub();
            const editor = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: {
                    sanitizeHtml,
                    quickActions: MATH_ACTION,
                    stream: async (_request, onData) => {
                        onData(String.raw`<p><span class="math-tex">\(c^2 = a^2</span></p>`);
                        await new Promise(() => {});
                    }
                },
                math: { engine }
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            await vi.waitFor(() => expect(previewHtml(editor)).toContain("math-tex"));
            expect(engine).not.toHaveBeenCalled();
        });
    });

    it("is disabled when no LLM provider is configured", async () => {
        const editor = await createEditor(QUICK_ACTIONS);
        expect(createComponent(editor).isEnabled).toBe(false);
    });

    // What the `/` palette and the right-click menu read instead of the config: the config only
    // seeded these, and both are replaced as content languages change or a custom action is written.
    describe("the lists it publishes", () => {
        it("hands out the groups and footer rows it is holding", async () => {
            const editor = await createEditor(QUICK_ACTIONS, createStreamStub().stream);
            const plugin = editor.plugins.get(AiAssistantUI);
            const footer = [ { label: "Model: Sonnet 5" } ];

            expect(plugin.quickActions).toEqual(QUICK_ACTIONS);
            expect(plugin.menuFooter).toEqual([]);

            plugin.updateMenuFooter(footer);
            expect(plugin.menuFooter).toEqual(footer);
        });
    });

    describe("streaming", () => {
        /** A stream that reports chunks on demand, so a test can pace them against the throttle. */
        function createPacedStream(usage?: AiCompletionUsage) {
            let emit: AiStreamCallback = () => undefined;
            let finish: () => void = () => undefined;
            const stream: AiStreamFunction = (_request, onData) => {
                emit = onData;
                return new Promise<AiCompletionUsage | void>((resolve) => {
                    finish = () => resolve(usage);
                });
            };
            return { stream, emit: (html: string) => emit(html), finish: () => finish() };
        }

        async function runPaced(paced: ReturnType<typeof createPacedStream>) {
            const editor = await createEditor(QUICK_ACTIONS, paced.stream);
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");
            return editor;
        }

        // The first chunk renders at once and opens the throttle window; the ones behind it
        // coalesce, so a fast stream re-parses its growing prefix a few times a second rather than
        // once per token.
        it("coalesces the chunks arriving inside the throttle window", async () => {
            const paced = createPacedStream();
            const editor = await runPaced(paced);

            paced.emit("<p>a</p>");
            await vi.waitFor(() => expect(previewHtml(editor)).toBe("<p>a</p>"));

            paced.emit("<p>ab</p>");
            paced.emit("<p>abc</p>");
            // Both landed inside the window, so the preview still shows what opened it...
            expect(previewHtml(editor)).toBe("<p>a</p>");
            // ...and the window closing shows the last of them, never the one in between.
            await vi.waitFor(() => expect(previewHtml(editor)).toBe("<p>abc</p>"));
        });

        // The window can outlive the stream, and what arrived inside it still has to be shown.
        it("flushes a chunk still pending when the stream ends", async () => {
            const paced = createPacedStream();
            const editor = await runPaced(paced);

            paced.emit("<p>a</p>");
            await vi.waitFor(() => expect(previewHtml(editor)).toBe("<p>a</p>"));
            paced.emit("<p>ab</p>");
            paced.finish();

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            expect(previewHtml(editor)).toBe("<p>ab</p>");
        });

        // Stop is not a failure: the run ends where the user ended it, and what arrived before that
        // is a response like any other — reviewable, and committable.
        it("keeps what already streamed when the user stops the run", async () => {
            const editor = await createEditor(QUICK_ACTIONS, (_request, onData, signal) => (
                new Promise<void>((_resolve, reject) => {
                    onData("<p>half an answ</p>");
                    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                })
            ));

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            const form = openForm(editor);
            await vi.waitFor(() => expect(previewHtml(editor)).toBe("<p>half an answ</p>"));
            form.fire("stop");

            await vi.waitFor(() => expect(form.phase).toBe("review"));
            // The abort was asked for, so it is not reported as something going wrong.
            expect(form.errorMessage).toBe("");
            expect(previewHtml(editor)).toBe("<p>half an answ</p>");
        });

        it("reports what the run cost, in the currency the provider quoted it in", async () => {
            const paced = createPacedStream({ model: "claude-sonnet-5", totalTokens: 1234, cost: 0.0042 });
            const editor = await runPaced(paced);
            paced.emit("<p>a</p>");
            paced.finish();

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            // Four decimals: a single completion usually costs well under a cent, and two would
            // round the whole thing away to $0.00.
            expect(form.usageText).toBe("claude-sonnet-5 · 1,234 tokens · ~$0.0042");
        });

        // Whatever the provider left out simply is not shown — a local model reports no price, and
        // a run that names one without counting tokens still has something worth saying.
        it("shows only the fields the provider reported", async () => {
            const paced = createPacedStream({ model: "llama4", totalTokens: 12 });
            const editor = await runPaced(paced);
            paced.emit("<p>a</p>");
            paced.finish();

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            expect(form.usageText).toBe("llama4 · 12 tokens");
        });

        it("drops to two decimals once the run costs more than a cent", async () => {
            const paced = createPacedStream({ cost: 1.5 });
            const editor = await runPaced(paced);
            paced.emit("<p>a</p>");
            paced.finish();

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            expect(form.usageText).toBe("~$1.50");
        });

        it("shows what the provider failed with, however it failed", async () => {
            const editor = await createEditor(QUICK_ACTIONS, () => Promise.reject(new Error("rate limited")));
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.errorMessage).toBe("rate limited"));

            // A provider that rejects with something other than an Error still has to say so.
            const other = await createEditor(QUICK_ACTIONS, () => Promise.reject("gateway closed"));
            setModelData(other.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(other))[0].fire("execute");

            await vi.waitFor(() => expect(openForm(other).errorMessage).toBe("gateway closed"));
        });

        // The sanitizer is the one piece of config with no fallback: the plugin would rather fail
        // the run than write model output into the preview unchecked.
        it("refuses to render at all when the host configured no sanitizer", async () => {
            const editor = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
                aiAssistant: { stream: createStreamStub().stream, quickActions: QUICK_ACTIONS } as never
            });

            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            await vi.waitFor(() => {
                expect(openForm(editor).errorMessage).toContain("ai-assistant-sanitize-html-required");
            });
        });
    });

    describe("committing below the target", () => {
        /** Runs one completion against whatever the model data selected, then commits it. */
        async function commitBelow(modelData: string, response = "<p>new</p>") {
            // BlockQuote for the nesting the walk exists to climb out of.
            const editor = await createTestEditor([Essentials, Paragraph, BlockQuote, TriliumAiAssistant], {
                aiAssistant: { sanitizeHtml, quickActions: QUICK_ACTIONS, stream: createStreamStub(response).stream }
            });
            setModelData(editor.model, modelData);
            quickActionButtons(createComponent(editor))[0].fire("execute");

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            form.fire("insertBelow");
            return editor;
        }

        // Out to the outermost block first: inserting after the paragraph itself would land the
        // response inside the quote it was taken from.
        it("clears the block the target is nested in", async () => {
            const editor = await commitBelow("<blockQuote><paragraph>[foo]</paragraph></blockQuote>");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe("<blockQuote><paragraph>foo</paragraph></blockQuote><paragraph>new</paragraph>");
        });

        // The marker is what "Replace" aims at, but it is not operational and rides on a model that
        // keeps changing behind the dialog. Losing it falls back to the live selection rather than
        // dropping the response the user already approved.
        it("falls back to the selection when the pinned target is gone", async () => {
            const editor = await createEditor(QUICK_ACTIONS, createStreamStub("<p>new</p>").stream);
            setModelData(editor.model, "<paragraph>[foo]</paragraph>");
            quickActionButtons(createComponent(editor))[0].fire("execute");

            const form = openForm(editor);
            await vi.waitFor(() => expect(form.phase).toBe("review"));
            editor.model.change((writer) => writer.removeMarker(AI_TARGET_MARKER));
            form.fire("replace");

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph>new</paragraph>");
        });

        // A range whose end sits in the root has no block to walk out of — it is already past one.
        it("inserts at the range's end when it ends in the root itself", async () => {
            const editor = await commitBelow("<paragraph>a</paragraph>[<paragraph>b</paragraph>]");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe("<paragraph>a</paragraph><paragraph>b</paragraph><paragraph>new</paragraph>");
        });
    });

    // The model is handed the words either side of the target so it can tell what it is writing
    // into, but only so many of them, and the ones nearest the target are the ones that place it.
    it("keeps the end nearest the target when the note runs on without a break", async () => {
        const { requests, stream } = createStreamStub();
        const editor = await createEditor(QUICK_ACTIONS, stream);
        const run = "x".repeat(2000);
        setModelData(editor.model, `<paragraph>${run}[foo]${run}</paragraph>`);

        quickActionButtons(createComponent(editor))[0].fire("execute");
        await vi.waitFor(() => expect(requests).toHaveLength(1));

        // One paragraph, so there is no line break to cut back to — the limit lands mid-run.
        expect(requests[0].surroundings.before).toBe("x".repeat(1500));
        expect(requests[0].surroundings.after).toBe("x".repeat(1500));
    });

    // Enter on an empty prompt is a stray keystroke, not a request to spend tokens on nothing.
    it("ignores a submit with nothing typed in it", async () => {
        const { requests, stream } = createStreamStub();
        const editor = await createEditor(QUICK_ACTIONS, stream);
        setModelData(editor.model, "<paragraph>[foo]</paragraph>");
        editor.execute("aiAssistant");

        const form = openForm(editor);
        form.query = "   ";
        form.fire("submit");

        expect(requests).toHaveLength(0);
        expect(form.phase).toBe("prompt");
    });

    it("keeps the response when the host's diff renderer throws", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const editor = await createTestEditor([Essentials, Paragraph, TriliumAiAssistant], {
            aiAssistant: {
                sanitizeHtml,
                quickActions: QUICK_ACTIONS,
                stream: createStreamStub("<p>fixed</p>").stream,
                diff: (() => {
                    throw new Error("no diff for you");
                }) as AiDiffFunction
            }
        });

        setModelData(editor.model, "<paragraph>[foo]</paragraph>");
        quickActionButtons(createComponent(editor))[0].fire("execute");

        const form = openForm(editor);
        await vi.waitFor(() => expect(form.phase).toBe("review"));
        // Only the Changes view is lost; the answer itself is still there to commit.
        expect(form.hasDiff).toBe(false);
        expect(previewHtml(editor)).toBe("<p>fixed</p>");
        expect(warn).toHaveBeenCalledWith("AI assistant: diff renderer failed", expect.any(Error));
    });
});
