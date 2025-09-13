/**
 * Chat module export
 */
import restChatService from './rest_chat_service.js';
import { ContextHandler } from './handlers/context_handler.js';
import { ToolHandler } from './handlers/tool_handler.js';
import { StreamHandler } from './handlers/stream_handler.js';
import * as messageFormatter from './utils/message_formatter.js';
import type { ChatSession, ChatMessage, NoteSource } from '../interfaces/chat_session.js';

// Export components
export {
    restChatService as default,
    ContextHandler,
    ToolHandler,
    StreamHandler,
    messageFormatter
};

// Export types
export type {
    ChatSession,
    ChatMessage,
    NoteSource
};
