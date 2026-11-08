import { ButtonView, FontBackgroundColor, FontColor, IconFontColor, Plugin } from "ckeditor5";
import type { Command, Editor } from "ckeditor5";

/** Draws the menu of the `colorMenu` button. See {@link ColorMenu}. */
export interface ColorMenuHost {
    show(request: ColorMenuRequest): void;
    hide(): void;
    destroy(): void;
    /**
     * Whether the shown menu takes the place of the on-screen keyboard. Its button then gives that
     * place back as it closes the menu, focusing the text in the same press, as a mobile browser
     * raises the keyboard only for a focus a press makes.
     */
    isInPlaceOfKeyboard?(): boolean;
}

/** The command a color of the menu runs: the color of the text, or its background. */
export type ColorMenuTarget = "fontColor" | "fontBackgroundColor";

/** What a {@link ColorMenuHost} shows a menu for. */
export interface ColorMenuRequest {
    /** The `colorMenu` button, which the menu opens under. */
    anchor: HTMLElement;
    /** The color of the text at the selection, or `null` when it has none. */
    fontColor: string | null;
    /** The background color of the text at the selection, or `null` when it has none. */
    fontBackgroundColor: string | null;
    /** Hides the menu, then sets the color of `target` at the selection, or removes it for `null`. */
    setColor(target: ColorMenuTarget, color: string | null): void;
    /**
     * Receives the menu's element once it is in the page, and `null` as it leaves. The editor
     * counts focus inside that element as its own, so the toolbar holding the button stays shown.
     */
    setElement(element: HTMLElement | null): void;
    /**
     * Called as the menu closes without setting a color. `returnFocus` puts focus back on the
     * button, for a menu closed with Escape rather than a press elsewhere.
     */
    onClose(returnFocus: boolean): void;
}

/**
 * Registers `colorMenu`, a button that opens one menu for both the color and the background color
 * of the text, drawn by the host application (`colorMenu.host`). Without a host, the button is not
 * registered.
 */
export default class ColorMenu extends Plugin {

    private host: ColorMenuHost | null = null;
    /** The menu the host shows, with that host, or `null`. */
    private shown: { request: ColorMenuRequest; host: ColorMenuHost } | null = null;

    static get requires() {
        return [FontColor, FontBackgroundColor] as const;
    }

    static get pluginName() {
        return "ColorMenu" as const;
    }

    init() {
        const editor = this.editor;
        const config = editor.config.get("colorMenu");
        if (!config) {
            return;
        }

        const t = editor.t;
        editor.ui.componentFactory.add("colorMenu", (locale) => {
            const button = new ButtonView(locale);
            button.set({ label: t("Color"), icon: IconFontColor, tooltip: true });
            button.bind("isEnabled").to(
                getCommand(editor, "fontColor"), "isEnabled",
                getCommand(editor, "fontBackgroundColor"), "isEnabled",
                (fontColor, fontBackgroundColor) => fontColor || fontBackgroundColor
            );
            button.on("execute", () => {
                if (this.shown) {
                    const toKeyboard = this.shown.host.isInPlaceOfKeyboard?.() ?? false;
                    this.hideMenu();
                    if (toKeyboard) {
                        editor.editing.view.focus();
                    }
                } else {
                    this.showMenu(button, () => config.host(editor));
                }
            });
            return button;
        });
    }

    override destroy() {
        super.destroy();
        this.host?.destroy();
    }

    private showMenu(button: ButtonView, createHost: () => ColorMenuHost) {
        const editor = this.editor;
        const host = this.host ??= createHost();
        let element: HTMLElement | null = null;

        const request: ColorMenuRequest = {
            // The button runs from its rendered element.
            anchor: button.element as HTMLElement,
            fontColor: getCommand(editor, "fontColor").value as string | undefined ?? null,
            fontBackgroundColor: getCommand(editor, "fontBackgroundColor").value as string | undefined ?? null,
            setColor: (target, color) => {
                this.hideMenu();
                editor.editing.view.focus();
                editor.execute(target, color === null ? {} : { value: color });
            },
            setElement: (next) => {
                if (element) {
                    editor.ui.focusTracker.remove(element);
                }
                element = next;
                if (element) {
                    editor.ui.focusTracker.add(element);
                }
            },
            onClose: (returnFocus) => {
                if (this.shown?.request !== request) {
                    return;
                }
                this.shown = null;
                if (returnFocus) {
                    button.focus();
                }
            }
        };

        this.shown = { request, host };
        host.show(request);
    }

    private hideMenu() {
        if (this.shown) {
            const { host } = this.shown;
            this.shown = null;
            host.hide();
        }
    }
}

/** A command `ColorMenu` requires, which its plugins register. */
function getCommand(editor: Editor, name: ColorMenuTarget) {
    return editor.commands.get(name) as Command;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ColorMenu.pluginName]: ColorMenu;
    }

    interface EditorConfig {
        /** Draws the menu of the `colorMenu` button. */
        colorMenu?: {
            /** Creates the menu, once per editor. */
            host(editor: Editor): ColorMenuHost;
        };
    }
}
