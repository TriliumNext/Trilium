import { AttributeCommand, Plugin, TwoStepCaretMovement } from "ckeditor5";

const KBD = "kbd";

/**
 * The keyboard shortcut (`kbd`) editing feature.
 *
 * It registers the `'kbd'` command, associated keystroke and introduces the
 * `kbd` attribute in the model which renders to the view as a `<kbd>` element.
 */
export default class KbdEditing extends Plugin {

    public static get pluginName() {
        return "KbdEditing" as const;
    }

    public static get requires() {
        return [TwoStepCaretMovement] as const;
    }

    /**
     * @inheritDoc
     */
    init() {
        const editor = this.editor;

        // Allow kbd attribute on text nodes.
        editor.model.schema.extend("$text", { allowAttributes: KBD });
        editor.model.schema.setAttributeProperties(KBD, {
            isFormatting: true,
            copyOnEnter: false
        });

        // Enable two-step caret movement so the user can arrow out of the kbd element.
        editor.plugins.get(TwoStepCaretMovement).registerAttribute(KBD);

        // Match every <kbd>, whatever attributes it carries. A pattern that demanded
        // spellcheck="false" left a plain <kbd> to General HTML Support, which drops it when the
        // allow-list is empty — the shipped default.
        editor.conversion.for("upcast").elementToAttribute({
            model: KBD,
            view: KBD
        });

        editor.conversion.for("dataDowncast").attributeToElement({
            model: KBD,
            view: KBD
        });

        // The browser spellchecker underlines key names, so switch it off where the user types.
        // Keeping spellcheck out of the data means the attribute never reaches stored content,
        // where `sanitizeHtml` strips it off <kbd> on every import.
        editor.conversion.for("editingDowncast").attributeToElement({
            model: KBD,
            view: {
                name: KBD,
                attributes: {
                    spellcheck: "false"
                }
            }
        });

        editor.commands.add(KBD, new AttributeCommand(editor, KBD));
        editor.keystrokes.set("CTRL+ALT+K", KBD);
    }

}
