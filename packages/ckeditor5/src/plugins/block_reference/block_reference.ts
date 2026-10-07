import { DomEmitterMixin, Plugin } from "ckeditor5";

import BlockReferenceEditing, {
    type AssignBlockReferenceCommand
} from "./block_reference_editing.js";

/**
 * References to blocks of a text note. A right click on the block handle calls
 * `openBlockHandleMenu()` of the host, whose menu copies a reference to the selected blocks.
 */
export default class BlockReference extends Plugin {

    private readonly domEmitter = new (DomEmitterMixin())();

    static get pluginName() {
        return "BlockReference" as const;
    }

    static get requires() {
        return [ BlockReferenceEditing ] as const;
    }

    afterInit() {
        const handle = this.getHandleElement();
        if (!handle) {
            return;
        }

        // The editor keeps the focus, so the handle and the selection stay.
        this.domEmitter.listenTo(handle, "mousedown", (_evt, event: MouseEvent) => {
            if (event.button === 2) {
                event.preventDefault();
            }
        });
        this.domEmitter.listenTo(handle, "contextmenu", (_evt, event: MouseEvent) => {
            event.preventDefault();
            this.openMenu(event);
        });
    }

    override destroy() {
        this.domEmitter.stopListening();
        super.destroy();
    }

    private getHandleElement() {
        const plugins = this.editor.plugins;
        if (plugins.has("BlockDragHandle")) {
            return plugins.get("BlockDragHandle").buttonView?.element;
        }
        if (plugins.has("BlockToolbar")) {
            return plugins.get("BlockToolbar").buttonView.element;
        }

        return null;
    }

    private openMenu(event: MouseEvent) {
        const editor = this.editor;
        const command = editor.commands.get("assignBlockReference");
        if (!command?.isEnabled) {
            return;
        }

        const component = glob.getComponentByEl<EditorComponent>(editor.editing.view.getDomRoot());
        component?.openBlockHandleMenu?.(event, command.value);
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [BlockReference.pluginName]: BlockReference;
        [BlockReferenceEditing.pluginName]: BlockReferenceEditing;
    }

    interface CommandsMap {
        assignBlockReference: AssignBlockReferenceCommand;
    }
}
