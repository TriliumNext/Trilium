/**
 * LLM Prompt Constants
 *
 * This file centralizes all LLM/AI prompts used throughout the application.
 * When adding new prompts, please add them here rather than hardcoding them in other files.
 *
 * Prompts are organized by their usage context (e.g., service, feature, etc.)
 */

import fs from 'fs';
import path from 'path';
import { RESOURCE_DIR } from '../../resource_dir';

// Load system prompt from markdown file
const loadSystemPrompt = (): string => {
    try {
        const promptPath = path.join(RESOURCE_DIR, "llm", "prompts", "base_system_prompt.md");
        const promptContent = fs.readFileSync(promptPath, 'utf8');
        // Strip the markdown title if needed
        return promptContent.replace(/^# TriliumNext Base System Prompt\n+/, '');
    } catch (error) {
        console.error('Failed to load system prompt from file:', error);
        // Return fallback prompt if file can't be loaded
        return "You are a helpful assistant embedded in the Trilium Notes application. " +
            "You can help users with their notes, answer questions, and provide information. " +
            "Keep your responses concise and helpful. " +
            "You're currently chatting with the user about their notes.";
    }
};

// Base system prompt loaded from markdown file
export const DEFAULT_SYSTEM_PROMPT = loadSystemPrompt();

/**
 * System prompts for different use cases
 */
export const SYSTEM_PROMPTS = {
    DEFAULT_SYSTEM_PROMPT:
        "You are an intelligent AI assistant for Trilium Notes, a hierarchical note-taking application. " +
        "Help the user with their notes, knowledge management, and questions. " +
        "When referencing their notes, be clear about which note you're referring to. " +
        "Be concise but thorough in your responses.",

    AGENT_TOOLS_PROMPT:
        "You are an intelligent AI assistant for Trilium Notes with access to special tools. " +
        "You can use these tools to search through the user's notes and find relevant information. " +
        "Always be helpful, accurate, and respect the user's privacy and security.",

    CONTEXT_AWARE_PROMPT:
        "You are an intelligent AI assistant for Trilium Notes. " +
        "You have access to the context from the user's notes. " +
        "Use this context to provide accurate and helpful responses. " +
        "Be specific when referencing information from their notes."
};

// Context-specific prompts
export const CONTEXT_PROMPTS = {
    // Query enhancer prompt for generating better search terms
    QUERY_ENHANCER:
        `You are an AI assistant that decides what information needs to be retrieved from a user's knowledge base called Trilium Notes to answer the user's question.
Given the user's question, generate 3-5 specific search queries that would help find relevant information.
Each query should be focused on a different aspect of the question.
Avoid generating queries that are too broad, vague, or about a user's entire Note database, and make sure they are relevant to the user's question.
Format your answer as a JSON array of strings, with each string being a search query.
Example: ["exact topic mentioned", "related concept 1", "related concept 2"]`,

    // Used to format notes context when providing responses
    CONTEXT_NOTES_WRAPPER:
        `I'll provide you with relevant information from my notes to help answer your question.

<notes>
{noteContexts}
</notes>

When referring to information from these notes in your response, please cite them by their titles (e.g., "According to your note on [Title]...") rather than using labels like "Note 1" or "Note 2".

Now, based on the above information, please answer: <query>{query}</query>`,

    // Default fallback when no notes are found
    NO_NOTES_CONTEXT:
        "I am an AI assistant helping you with your Trilium notes. " +
        "I couldn't find any specific notes related to your query, but I'll try to assist you " +
        "with general knowledge about Trilium or other topics you're interested in.",

    // Fallback when context building fails
    ERROR_FALLBACK_CONTEXT:
        "I'm your AI assistant helping with your Trilium notes. I'll try to answer based on what I know.",

    // Headers for context (by provider)
    CONTEXT_HEADERS: {
        ANTHROPIC: (query: string) =>
            `I'm your AI assistant helping with your Trilium notes database. For your query: "<query>${query}</query>", I found these relevant <notes>`,
        DEFAULT: (query: string) =>
            `I've found some relevant information in your notes that may help answer: "<query>${query}</query>"\n\n<notes>`
    },

    // Closings for context (by provider)
    CONTEXT_CLOSINGS: {
        ANTHROPIC:
            "</notes>\n\nPlease use this information to answer the user's query. If the notes don't contain enough information, you can use your general knowledge as well.",
        DEFAULT:
            "</notes>\n\nBased on this information from the user's notes, please provide a helpful response."
    },

    // Context for index service
    INDEX_NO_NOTES_CONTEXT:
        "I'm an AI assistant helping with your Trilium notes. I couldn't find specific notes related to your query, but I'll try to assist based on general knowledge.",

    // Prompt for adding note context to chat
    NOTE_CONTEXT_PROMPT: `Here is the content of the note I want to discuss:

<note_content>
{context}
</note_content>

Please help me with this information.`,

    // Prompt for adding semantic note context to chat
    SEMANTIC_NOTE_CONTEXT_PROMPT: `Here is the relevant information from my notes based on my query "<query>{query}</query>":

<notes_context>
{context}
</notes_context>

Please help me understand this information in relation to my query.`,

    // System message prompt for context-aware chat
    CONTEXT_AWARE_SYSTEM_PROMPT: `You are an AI assistant helping with Trilium Notes. Use this context to answer the user's question:

<enhanced_context>
{enhancedContext}
</enhanced_context>`,

    // Error messages
    ERROR_MESSAGES: {
        GENERAL_ERROR: `Error: Failed to generate response. {errorMessage}`,
        CONTEXT_ERROR: `Error: Failed to generate response with note context. {errorMessage}`
    },

    // Merged from JS file
    AGENT_TOOLS_CONTEXT_PROMPT:
        "You have access to the following tools to help answer the user's question: <tools>{tools}</tools>"
};

// Agent tool prompts
export const AGENT_TOOL_PROMPTS = {
    // Prompts for query decomposition
    QUERY_DECOMPOSITION: {
        SUB_QUERY_DIRECT: '<query_type>Direct question that can be answered without decomposition</query_type>',
        SUB_QUERY_GENERIC: '<query_type>Generic exploration to find related content</query_type>',
        SUB_QUERY_ERROR: '<query_type>Error in decomposition, treating as simple query</query_type>',
        SUB_QUERY_DIRECT_ANALYSIS: '<query_type>Direct analysis of note details</query_type>',
        ORIGINAL_QUERY: '<query_type>Original query</query_type>'
    },

    // Prompts for contextual thinking tool
    CONTEXTUAL_THINKING: {
        STARTING_ANALYSIS: (query: string) => `Starting analysis of the query: "<query>${query}</query>"`,
        KEY_COMPONENTS: '<analysis>What are the key components of this query that need to be addressed?</analysis>',
        BREAKING_DOWN: '<analysis>Breaking down the query to understand its requirements and context.</analysis>'
    }
};

// Provider-specific prompt modifiers
export const PROVIDER_PROMPTS = {
    ANTHROPIC: {
        // Anthropic Claude-specific prompt formatting
        SYSTEM_WITH_CONTEXT: (context: string) =>
            `<instructions>
${DEFAULT_SYSTEM_PROMPT}

Use the following information from the user's notes to answer their questions:

<user_notes>
${context}
</user_notes>

When responding:
- Focus on the most relevant information from the notes
- Be concise and direct in your answers
- If quoting from notes, mention which note it's from
- If the notes don't contain relevant information, say so clearly
</instructions>`,

        INSTRUCTIONS_WRAPPER: (instructions: string) =>
            `<instructions>\n${instructions}\n</instructions>`,

        // Tool instructions for Anthropic Claude
        TOOL_INSTRUCTIONS: `<instructions>
When using tools to search for information, follow these requirements:

1. ALWAYS TRY MULTIPLE SEARCH APPROACHES before concluding information isn't available
2. YOU MUST PERFORM AT LEAST 3 DIFFERENT SEARCHES with varied parameters before giving up
3. If a search returns no results:
   - Try broader terms (e.g., "Kubernetes" instead of "Kubernetes deployment")
   - Use synonyms (e.g., "meeting" instead of "conference")
   - Remove specific qualifiers (e.g., "report" instead of "Q3 financial report")
   - Try different search tools (search_notes for conceptual matches, keyword_search_notes for exact matches)
4. NEVER tell the user "there are no notes about X" until you've tried multiple search variations
5. EXPLAIN your search strategy when adjusting parameters (e.g., "I'll try a broader search for...")
6. When searches fail, AUTOMATICALLY try different approaches rather than asking the user what to do
</instructions>`,

        ACKNOWLEDGMENT: "I understand. I'll follow those instructions.",
        CONTEXT_ACKNOWLEDGMENT: "I'll help you with your notes based on the context provided.",
        CONTEXT_QUERY_ACKNOWLEDGMENT: "I'll help you with your notes based on the context provided. What would you like to know?"
    },

    OPENAI: {
        // OpenAI-specific prompt formatting
        SYSTEM_WITH_CONTEXT: (context: string) =>
            `<system_prompt>
You are an AI assistant integrated into Trilium Notes.
Use the following information from the user's notes to answer their questions:

<user_notes>
${context}
</user_notes>

Focus on relevant information from these notes when answering.
Be concise and informative in your responses.
</system_prompt>`,

        // Tool instructions for OpenAI models
        TOOL_INSTRUCTIONS: `When using tools to search for information, you must follow these requirements:

1. ALWAYS TRY MULTIPLE SEARCH APPROACHES before concluding information isn't available
2. YOU MUST PERFORM AT LEAST 3 DIFFERENT SEARCHES with varied parameters before giving up
3. If a search returns no results:
   - Try broader terms (e.g., "Kubernetes" instead of "Kubernetes deployment")
   - Use synonyms (e.g., "meeting" instead of "conference")
   - Remove specific qualifiers (e.g., "report" instead of "Q3 financial report")
   - Try different search tools (search_notes for conceptual matches, keyword_search_notes for exact matches)
4. NEVER tell the user "there are no notes about X" until you've tried multiple search variations
5. EXPLAIN your search strategy when adjusting parameters (e.g., "I'll try a broader search for...")
6. When searches fail, AUTOMATICALLY try different approaches rather than asking the user what to do`
    },

    OLLAMA: {
        // Ollama-specific prompt formatting
        CONTEXT_INJECTION: (context: string, query: string) =>
            `Here's information from my notes to help answer the question:

${context}

Based on this information, please answer: <query>${query}</query>`,

        // Tool instructions for Ollama
        TOOL_INSTRUCTIONS: `
CRITICAL INSTRUCTIONS FOR TOOL USAGE:
1. YOU MUST TRY MULTIPLE TOOLS AND SEARCH VARIATIONS before concluding information isn't available
2. ALWAYS PERFORM AT LEAST 3 DIFFERENT SEARCHES with different parameters before giving up on finding information
3. If a search returns no results, IMMEDIATELY TRY ANOTHER SEARCH with different parameters:
   - Use broader terms: If "Kubernetes deployment" fails, try just "Kubernetes" or "container orchestration"
   - Try synonyms: If "meeting notes" fails, try "conference", "discussion", or "conversation"
    - Remove specific qualifiers: If "quarterly financial report 2024" fails, try just "financial report"
    - Try semantic variations: If keyword_search_notes fails, use search_notes which finds conceptually related content
  4. CHAIN TOOLS TOGETHER: Use the results of one tool to inform parameters for the next tool
  5. NEVER respond with "there are no notes about X" until you've tried at least 3 different search variations
  6. DO NOT ask the user what to do next when searches fail - AUTOMATICALLY try different approaches
  7. ALWAYS EXPLAIN what you're doing: "I didn't find results for X, so I'm now searching for Y instead"
  8. If all reasonable search variations fail (minimum 3 attempts), THEN you may inform the user that the information might not be in their notes`
    },

    MINIMAX: {
        // MiniMax uses Anthropic-compatible API, so we use similar prompts
        SYSTEM_WITH_CONTEXT: (context: string) =>
            `<instructions>
${DEFAULT_SYSTEM_PROMPT}

Use the following information from the user's notes to answer their questions:

<user_notes>
${context}
</user_notes>

When responding:
- Focus on the most relevant information from the notes
- Be concise and direct in your answers
- If quoting from notes, mention which note it's from
- If the notes don't contain relevant information, say so clearly
</instructions>`,

        INSTRUCTIONS_WRAPPER: (instructions: string) =>
            `<instructions>\n${instructions}\n</instructions>`,

        // Tool instructions for MiniMax (Anthropic-compatible)
        TOOL_INSTRUCTIONS: `<instructions>
When using tools to search for information, follow these requirements:

1. ALWAYS TRY MULTIPLE SEARCH APPROACHES before concluding information isn't available
2. YOU MUST PERFORM AT LEAST 3 DIFFERENT SEARCHES with varied parameters before giving up
3. If a search returns no results:
   - Try broader terms (e.g., "Kubernetes" instead of "Kubernetes deployment")
   - Use synonyms (e.g., "meeting" instead of "conference")
   - Remove specific qualifiers (e.g., "report" instead of "Q3 financial report")
   - Try different search tools (search_notes for conceptual matches, keyword_search_notes for exact matches)
4. NEVER tell the user "there are no notes about X" until you've tried multiple search variations
5. EXPLAIN your search strategy when adjusting parameters (e.g., "I'll try a broader search for...")
6. When searches fail, AUTOMATICALLY try different approaches rather than asking the user what to do
</instructions>`,

        ACKNOWLEDGMENT: "I understand. I'll follow those instructions.",
        CONTEXT_ACKNOWLEDGMENT: "I'll help you with your notes based on the context provided.",
        CONTEXT_QUERY_ACKNOWLEDGMENT: "I'll help you with your notes based on the context provided. What would you like to know?"
    },

    // Common prompts across providers
    COMMON: {
        DEFAULT_ASSISTANT_INTRO: "<assistant_role>You are an AI assistant integrated into Trilium Notes. Focus on helping users find information in their notes and answering questions based on their knowledge base. Be concise, informative, and direct when responding to queries.</assistant_role>"
    }
};

// Constants for formatting context and messages
export const FORMATTING_PROMPTS = {
    // Headers for context formatting
    CONTEXT_HEADERS: {
        SIMPLE: (query: string) => `I'm searching for information about: <query>${query}</query>\n\n<notes>Here are the most relevant notes from my knowledge base:`,
        DETAILED: (query: string) => `I'm searching for information about: "<query>${query}</query>"\n\n<notes>Here are the most relevant notes from my personal knowledge base:`
    },

    // Closing text for context formatting
    CONTEXT_CLOSERS: {
        SIMPLE: `</notes>\nEnd of notes. Please use this information to answer my question comprehensively.`,
        DETAILED: `</notes>\nEnd of context information. Please use only the above notes to answer my question as comprehensively as possible.`
    },

    // Dividers used in context formatting
    DIVIDERS: {
        NOTE_SECTION: `------ NOTE INFORMATION ------`,
        CONTENT_SECTION: `------ CONTEXT INFORMATION ------`,
        NOTE_START: `# Note: `,
        CONTENT_START: `Content: `
    },

    HTML_ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'code', 'pre']
};

// Prompt templates for chat service
export const CHAT_PROMPTS = {
    // Introduction messages for new chats
    INTRODUCTIONS: {
        NEW_CHAT: "<greeting>Welcome to TriliumNext AI Assistant. How can I help you with your notes today?</greeting>",
        SEMANTIC_SEARCH: "<instruction>I'll search through your notes for relevant information. What would you like to know?</instruction>"
    },

    // Placeholders for various chat scenarios
    PLACEHOLDERS: {
        NO_CONTEXT: "<status>I don't have any specific note context yet. Would you like me to search your notes for something specific?</status>",
        WAITING_FOR_QUERY: "<prompt>Awaiting your question...</prompt>"
    }
};

// Error messages and fallbacks
export const ERROR_PROMPTS = {
    // User-facing error messages
    USER_ERRORS: {
        GENERAL_ERROR: "I encountered an error processing your request. Please try again or rephrase your question.",
        CONTEXT_ERROR: "I couldn't retrieve context from your notes. Please check your query or try a different question.",
        NETWORK_ERROR: "There was a network error connecting to the AI service. Please check your connection and try again.",
        RATE_LIMIT: "The AI service is currently experiencing high demand. Please try again in a moment.",

        // Merged from JS file
        PROVIDER_ERROR:
            "I'm sorry, but there seems to be an issue with the AI service provider. " +
            "Please check your connection and API settings, or try again later."
    },

    // Internal error handling
    INTERNAL_ERRORS: {
        CONTEXT_PROCESSING: "Error processing context data",
        MESSAGE_FORMATTING: "Error formatting messages for LLM",
        RESPONSE_PARSING: "Error parsing LLM response"
    },

    // Merged from JS file
    SYSTEM_ERRORS: {
        NO_PROVIDER_AVAILABLE:
            "No AI provider is available. Please check your AI settings and ensure at least one provider is configured properly.",

        UNAUTHORIZED:
            "The AI provider returned an authorization error. Please check your API key settings."
    }
};
