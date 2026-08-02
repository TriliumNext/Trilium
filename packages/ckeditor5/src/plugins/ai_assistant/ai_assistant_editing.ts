import { Command, Plugin } from "ckeditor5";

import type { AiAssistantConfig } from "./ai_assistant_config.js";
import type AiAssistantUI from "./ai_assistant_ui.js";

/**
 * The model marker pinning the text the assistant was opened on. Unlike the live selection it
 * survives focus moving into the balloon, and it is remapped as the user keeps editing, so
 * "Replace" always hits the content that was originally selected. `affectsData: false` keeps it
 * out of the document data and the undo stack.
 */
export const AI_TARGET_MARKER = "triliumAiTarget";

/**
 * The editing side of the AI assistant: the target-marker highlight and the `aiAssistant` command.
 * There is no schema or data conversion — the feature never stores anything in the document until
 * the user commits, and then it inserts perfectly ordinary content.
 */
export default class AiAssistantEditing extends Plugin {

    static get pluginName() {
        return "AiAssistantEditing" as const;
    }

    public init(): void {
        const editor = this.editor;

        // Editing-only: the tint shows what "Replace" will hit; the data never contains the marker.
        editor.conversion.for("editingDowncast").markerToHighlight({
            model: AI_TARGET_MARKER,
            view: { classes: "ck-ai-assistant-target" }
        });

        editor.commands.add("aiAssistant", new ShowAiAssistantCommand(editor));
    }
}

/**
 * Opens the AI assistant balloon on the current selection. Exists as a command (rather than the
 * button calling the UI directly) so keystrokes and slash-command entries can gate on and trigger
 * the feature the same way they do every other one.
 */
export class ShowAiAssistantCommand extends Command {

    public override refresh(): void {
        const config = this.editor.config.get("aiAssistant") as AiAssistantConfig | undefined;
        this.isEnabled = !!config?.stream;
    }

    public override execute(): void {
        // Looked up by name: the command lives in the editing plugin, and a class import of the UI
        // plugin here would cycle (UI → editing → UI). The type still resolves via `PluginsMap`.
        (this.editor.plugins.get("AiAssistantUI") as AiAssistantUI).show();
    }
}
