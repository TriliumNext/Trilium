import { CONTENT_EMBED_KIND_ATTRIBUTE } from "@triliumnext/commons";
import {
    CKEditorError,
    type Editor,
    type ModelElement,
    Plugin,
    toWidget,
    type ViewElement,
    Widget
} from "ckeditor5";

const MODEL_NAME = "unknownContentEmbed";

/** A `<section>` that names an embed kind, kept raw: the view gets no children. */
const ENVELOPE = { name: "section", attributes: { [CONTENT_EMBED_KIND_ATTRIBUTE]: true as const } };

/**
 * Keeps an embed of a kind that this version does not know as it was saved. The editor shows the
 * host's placeholder (`contentEmbed.loadUnknown()`), and `getData()` writes the section back with
 * its `class` and `data-*` attributes and its sanitized content.
 */
export default class UnknownContentEmbed extends Plugin {

    static get requires() {
        return [ Widget ] as const;
    }

    static get pluginName() {
        return "UnknownContentEmbed" as const;
    }

    init() {
        const editor = this.editor;

        editor.model.schema.register(MODEL_NAME, {
            isObject: true,
            isBlock: true,
            allowWhere: "$block",
            allowAttributes: [ "embedAttributes", "embedContent" ]
        });

        editor.data.registerRawContentMatcher(ENVELOPE);

        // Runs before General HTML Support, which converts `<section>` too when allowed.
        editor.conversion.for("upcast").elementToElement({
            view: ENVELOPE,
            model: (viewElement, { writer }) => writer.createElement(MODEL_NAME, {
                embedAttributes: getKeptAttributes(viewElement),
                embedContent: sanitize(editor, getRawContent(viewElement))
            }),
            converterPriority: "high"
        });
        editor.conversion.for("dataDowncast").elementToElement({
            model: MODEL_NAME,
            view: (modelElement, { writer }) => writer.createRawElement(
                "section", getEmbedAttributes(modelElement), (domElement) => {
                    domElement.innerHTML = modelElement.getAttribute("embedContent") as string;
                })
        });
        editor.conversion.for("editingDowncast").elementToElement({
            model: MODEL_NAME,
            view: (modelElement, { writer }) => {
                const attributes = getEmbedAttributes(modelElement);
                const boxSize = attributes["data-box-size"];
                const wrapper = writer.createUIElement("div", {
                    "class": "include-note-wrapper",
                    "data-cke-ignore-events": true
                }, function (domDocument) {
                    const domElement = this.toDomElement(domDocument);
                    editor.config.get("contentEmbed.loadUnknown")?.(domElement, boxSize);
                    return domElement;
                });
                const section = writer.createContainerElement("section", {
                    class: "include-note unknown-content-embed",
                    [CONTENT_EMBED_KIND_ATTRIBUTE]: attributes[CONTENT_EMBED_KIND_ATTRIBUTE],
                    ...(boxSize ? { "data-box-size": boxSize } : {})
                }, [ wrapper ]);
                return toWidget(section, writer, {
                    label: editor.t("unknown embed widget"),
                    hasSelectionHandle: true
                });
            }
        });
    }

}

/** The `class` and `data-*` attributes of the section. Others, such as `style`, are dropped. */
function getKeptAttributes(viewElement: ViewElement) {
    const attributes: Record<string, string> = {};
    for (const [ name, value ] of viewElement.getAttributes()) {
        if (name === "class" || name.startsWith("data-")) {
            attributes[name] = String(value);
        }
    }
    return attributes;
}

/** The inner HTML that `registerRawContentMatcher()` keeps for the section. */
function getRawContent(viewElement: ViewElement) {
    return viewElement.getCustomProperty("$rawContent") as string;
}

function getEmbedAttributes(modelElement: ModelElement) {
    return modelElement.getAttribute("embedAttributes") as Record<string, string>;
}

function sanitize(editor: Editor, html: string) {
    const sanitizeHtml = editor.config.get("contentEmbed")?.sanitizeHtml;
    if (!sanitizeHtml) {
        throw new CKEditorError("content-embed-sanitize-html-required", {
            pluginName: UnknownContentEmbed.pluginName
        });
    }
    return sanitizeHtml(html);
}

declare module "ckeditor5" {
    interface PluginsMap {
        [UnknownContentEmbed.pluginName]: UnknownContentEmbed;
    }
}
