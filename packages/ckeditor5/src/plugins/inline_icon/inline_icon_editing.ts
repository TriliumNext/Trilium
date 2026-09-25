import {
    Command, type Editor, ModelElement, type ModelWriter, Plugin, toWidget, type ViewElement, Widget
} from "ckeditor5";

/** The model element for an icon; the glyph comes from {@link ICON_CLASS}. */
export const ICON = "inlineIcon";

/** The icon pack's own class, such as `bx bx-star`. */
const ICON_CLASS = "iconClass";

/** The class on every icon in the app, beside the pack's own, and what the upcast matches. */
const MARKER_CLASS = "tn-icon";

export const INSERT_ICON_COMMAND = "insertIcon";

export const ICON_TRANSFORM_COMMAND = "iconTransform";

/**
 * The classes that rotate or mirror a glyph. The application already writes them by hand — the
 * right pane's icon is `bx bx-sidebar bx-flip-horizontal` — and the rules in
 * `boxicons-compat.css` are not scoped to a pack, so they apply to any icon.
 *
 * Each rule sets `transform` at the same specificity, so two classes never combine: the one
 * declared last in the stylesheet applies. An icon therefore has one of these or none, which is
 * why {@link IconTransformCommand} stores a single value rather than five flags.
 */
export const ICON_TRANSFORMS = [
    "bx-rotate-90",
    "bx-rotate-180",
    "bx-rotate-270",
    "bx-flip-horizontal",
    "bx-flip-vertical"
] as const;

export type IconTransform = typeof ICON_TRANSFORMS[number];

/**
 * The icon editing feature: an inline widget for one icon of an installed icon pack, stored as
 * `<span class="tn-icon bx bx-star"></span>` — the markup icons use everywhere else in the
 * application, so the share theme and the in-app help render it with no editor-specific code.
 *
 * {@link InlineIconUI} provides the picker; this plugin only performs the insert.
 */
export default class InlineIconEditing extends Plugin {

    public static get pluginName() {
        return "InlineIconEditing" as const;
    }

    public static get requires() {
        return [ Widget ] as const;
    }

    init() {
        const editor = this.editor;

        editor.model.schema.register(ICON, {
            allowWhere: "$text",
            isInline: true,
            // Self-contained: the caret cannot be put inside it, and it is selected as a unit.
            isObject: true,
            // CKEditor's own converters handle these two, so colouring needs none here.
            allowAttributes: [ ICON_CLASS, "fontColor", "fontBackgroundColor", "fontSize" ]
        });

        editor.conversion.for("upcast").elementToElement({
            view: {
                name: "span",
                classes: [ MARKER_CLASS ]
            },
            model: (viewElement, { writer }) => writer.createElement(ICON, {
                [ICON_CLASS]: readIconClass(viewElement)
            })
        });

        // An empty element rather than a container: the data pipeline fills an empty container
        // with an `&nbsp;`, which would be drawn as a space beside the icon.
        editor.conversion.for("dataDowncast").elementToElement({
            model: ICON,
            view: (modelElement, { writer }) => writer.createEmptyElement("span", {
                class: viewClasses(modelElement)
            })
        });

        editor.conversion.for("editingDowncast").elementToElement({
            // Naming the attribute converts the element again when it changes, which is how a
            // transform set from the toolbar reaches the view.
            model: { name: ICON, attributes: [ ICON_CLASS ] },
            view: (modelElement, { writer }) => {
                const widget = toWidget(
                    writer.createContainerElement("span", { class: viewClasses(modelElement) }),
                    writer,
                    { label: editor.t("Icon") }
                );

                // How InlineIconToolbar identifies an icon: the widget element itself has only
                // the pack's classes.
                writer.setCustomProperty(ICON, true, widget);

                return widget;
            }
        });

        editor.commands.add(INSERT_ICON_COMMAND, new InsertIconCommand(editor));
        editor.commands.add(ICON_TRANSFORM_COMMAND, new IconTransformCommand(editor));
    }

}

/**
 * Inserts one icon at the selection, replacing an icon that selection is already on. See
 * {@link InlineIconEditing}.
 */
class InsertIconCommand extends Command {

    override refresh() {
        const model = this.editor.model;
        const parent = model.document.selection.focus?.parent;
        const isAllowed = parent instanceof ModelElement && model.schema.checkChild(parent, ICON);

        this.isEnabled = !this.editor.isReadOnly && isAllowed;
    }

    override execute({ iconClass }: { iconClass: string }) {
        if (!iconClass.trim()) {
            return;
        }

        const model = this.editor.model;

        // A replacement copies `fontColor` and the rest from the icon it replaces, because a
        // selection on an object element has no attributes of its own. An insert copies them from
        // the caret, so an icon inserted into coloured text is that colour.
        const replaced = selectedIcon(this.editor);
        const inherited = replaced
            ? replaced.getAttributes()
            : model.document.selection.getAttributes();

        model.change((writer: ModelWriter) => {
            const icon = writer.createElement(ICON, {
                ...Object.fromEntries(inherited),
                [ICON_CLASS]: iconClass
            });

            model.insertObject(icon, null, null, { setSelection: "after" });
        });
    }

}

/**
 * Rotates or mirrors the selected icon by rewriting the transform among its classes, of which
 * there is at most one (see {@link ICON_TRANSFORMS}). `null` restores the icon to upright.
 */
class IconTransformCommand extends Command {

    declare public value: IconTransform | null;

    override refresh() {
        const icon = selectedIcon(this.editor);

        this.value = icon ? readTransform(icon) : null;
        this.isEnabled = !this.editor.isReadOnly && !!icon;
    }

    override execute({ transform }: { transform: IconTransform | null }) {
        const icon = selectedIcon(this.editor);

        /* v8 ignore next 3 -- the command is enabled only while an icon is selected */
        if (!icon) {
            return;
        }

        const classNames = readClasses(icon).filter((className) => !isTransform(className));

        if (transform) {
            classNames.push(transform);
        }

        this.editor.model.change((writer: ModelWriter) => {
            writer.setAttribute(ICON_CLASS, classNames.join(" "), icon);
        });
    }

}

/** The pack's classes: every class on the element apart from {@link MARKER_CLASS}. */
function readIconClass(viewElement: ViewElement) {
    return Array.from(viewElement.getClassNames())
        .filter((className) => className !== MARKER_CLASS)
        .join(" ");
}

/** The classes the element gets in the view: the marker class, then the pack's own. */
function viewClasses(modelElement: ModelElement) {
    const iconClass = modelElement.getAttribute(ICON_CLASS);

    return iconClass ? `${MARKER_CLASS} ${iconClass}` : MARKER_CLASS;
}

/** The icon the selection is on, which is the only one a transform applies to. */
function selectedIcon(editor: Editor) {
    const selected = editor.model.document.selection.getSelectedElement();

    return selected?.is("element", ICON) ? selected : null;
}

/** The transform class on an icon, or `null` where it is upright. */
function readTransform(icon: ModelElement): IconTransform | null {
    return readClasses(icon).find(isTransform) ?? null;
}

function isTransform(className: string): className is IconTransform {
    return (ICON_TRANSFORMS as readonly string[]).includes(className);
}

function readClasses(icon: ModelElement) {
    return String(icon.getAttribute(ICON_CLASS) ?? "").split(/\s+/).filter(Boolean);
}
