import { ButtonView, Command, type Editor, ImageUtils, Plugin } from "ckeditor5";
import copyIcon from "../icons/copy.svg?raw";
import downloadIcon from "../icons/download.svg?raw";

/**
 * Callbacks injected by the host application (see the editor's `imageActions` config) that
 * perform the actual platform-specific work. The plugin only resolves the selected image's
 * `src` and hands it over — the clipboard/download mechanics live in the client.
 */
interface ImageActionsConfig {
    copyToClipboard?: (src: string) => void;
    download?: (src: string) => void;
}

type ImageAction = keyof ImageActionsConfig;

/**
 * Adds "copy to clipboard" and "download" buttons to the image balloon toolbar. The buttons
 * are thin wrappers: they look up the selected image's source and delegate to the callbacks
 * provided in the `imageActions` editor config.
 */
export default class ImageActions extends Plugin {

    static get requires() {
        return [ImageUtils] as const;
    }

    init() {
        const t = this.editor.t;

        // Translated here rather than inside the helper: each label has to be a literal argument of
        // a `t()` call for the message registry to find it (see `messages.ts`).
        this._registerButton("copyImageToClipboard", t("Copy image to clipboard"), copyIcon, "copyToClipboard");
        this._registerButton("downloadImage", t("Download image"), downloadIcon, "download");
    }

    /** `label` arrives already translated — see {@link ImageActions#init}. */
    private _registerButton(name: string, label: string, icon: string, action: ImageAction) {
        const editor = this.editor;
        const command = new ImageActionCommand(editor, action);
        editor.commands.add(name, command);

        editor.ui.componentFactory.add(name, (locale) => {
            const button = new ButtonView(locale);
            button.set({
                label,
                icon,
                tooltip: true
            });
            button.bind("isEnabled").to(command, "isEnabled");
            this.listenTo(button, "execute", () => editor.execute(name));
            return button;
        });
    }

}

class ImageActionCommand extends Command {

    constructor(editor: Editor, private readonly action: ImageAction) {
        super(editor);
    }

    override refresh() {
        this.isEnabled = !!this._getSelectedImageSrc();
    }

    override execute() {
        const src = this._getSelectedImageSrc();
        if (!src) {
            return;
        }

        const config = this.editor.config.get("imageActions") as ImageActionsConfig | undefined;
        config?.[this.action]?.(src);
    }

    private _getSelectedImageSrc() {
        const imageUtils = this.editor.plugins.get(ImageUtils);
        const imageElement = imageUtils.getClosestSelectedImageElement(this.editor.model.document.selection);
        const src = imageElement?.getAttribute("src");
        return typeof src === "string" ? src : null;
    }

}
