import { Plugin } from "ckeditor5";

import type { AiAssistantConfig } from "./ai_assistant_config.js";
import AiAssistantEditing, { type ShowAiAssistantCommand } from "./ai_assistant_editing.js";
import AiAssistantUI from "./ai_assistant_ui.js";

/**
 * Trilium's GPL take on the premium `AIAssistant` feature: ask the configured LLM provider to
 * rewrite the selection (or generate new content), watch the response stream into a preview inside
 * the dialog, then commit it with Replace or Insert below — one document write, one undo step.
 *
 * The transport is injected by the host through `config.aiAssistant.stream` (see
 * {@link AiAssistantConfig}), so the plugin works with whatever LLM provider Trilium has
 * configured and stays completely provider-agnostic. Without that callback the feature disables
 * itself.
 */
export default class TriliumAiAssistant extends Plugin {

    static get requires() {
        return [AiAssistantEditing, AiAssistantUI] as const;
    }

    static get pluginName() {
        return "TriliumAiAssistant" as const;
    }
}

declare module "ckeditor5" {
    interface EditorConfig {
        aiAssistant?: AiAssistantConfig;
    }

    interface PluginsMap {
        [TriliumAiAssistant.pluginName]: TriliumAiAssistant;
        [AiAssistantEditing.pluginName]: AiAssistantEditing;
        [AiAssistantUI.pluginName]: AiAssistantUI;
    }

    interface CommandsMap {
        aiAssistant: ShowAiAssistantCommand;
    }
}
