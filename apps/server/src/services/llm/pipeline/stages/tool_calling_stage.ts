import type { NormalizedChatResponse, Message } from '../../ai_interface.js';
import type { ToolExecutionInput } from '../interfaces.js';
import { BasePipelineStage } from '../pipeline_stage.js';
import { executeToolCalling } from './tool_calling_executor.js';

/**
 * Pipeline stage for handling LLM tool calling.
 */
export class ToolCallingStage extends BasePipelineStage<ToolExecutionInput, { response: NormalizedChatResponse, needsFollowUp: boolean, messages: Message[] }> {
    constructor() {
        super('ToolCalling');
    }

    protected async process(input: ToolExecutionInput): Promise<{ response: NormalizedChatResponse, needsFollowUp: boolean, messages: Message[] }> {
        return executeToolCalling({
            response: input.response,
            messages: input.messages,
            options: input.options,
            streamCallback: input.streamCallback
        });
    }
}
