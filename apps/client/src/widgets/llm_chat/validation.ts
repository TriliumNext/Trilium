/**
 * Validation functions for LLM Chat
 */
import type { OptionNames } from "@triliumnext/commons";
import options from "../../services/options.js";
import { t } from "../../services/i18n.js";

/**
 * Validate providers configuration
 */
export async function validateProviders(validationWarning: HTMLElement): Promise<void> {
    try {
        // Check if AI is enabled
        const aiEnabled = options.is('aiEnabled');
        if (!aiEnabled) {
            validationWarning.style.display = 'none';
            return;
        }

        // Get precedence list from options
        const precedenceStr = options.get('aiProviderPrecedence') || 'openai,anthropic,ollama';
        let precedenceList: string[] = [];

        if (precedenceStr) {
            if (precedenceStr.startsWith('[') && precedenceStr.endsWith(']')) {
                try {
                    precedenceList = JSON.parse(precedenceStr);
                } catch (e) {
                    console.error('Error parsing precedence list:', e);
                    precedenceList = ['openai']; // Default if parsing fails
                }
            } else if (precedenceStr.includes(',')) {
                precedenceList = precedenceStr.split(',').map(p => p.trim());
            } else {
                precedenceList = [precedenceStr];
            }
        }

        // Check for configuration issues with providers in the precedence list
        const configIssues: string[] = [];

        // Always add experimental warning as the first item
        configIssues.push(t("ai_llm.experimental_warning"));

        // Check each provider in the precedence list for proper configuration
        for (const provider of precedenceList) {
            if (provider === 'openai') {
                // Check OpenAI configuration via server-provided boolean flag
                const isKeySet = options.is('isOpenaiApiKeySet' as OptionNames);
                if (!isKeySet) {
                    configIssues.push(`OpenAI API key is missing (optional for OpenAI-compatible endpoints)`);
                }
            } else if (provider === 'anthropic') {
                // Check Anthropic configuration via server-provided boolean flag
                const isKeySet = options.is('isAnthropicApiKeySet' as OptionNames);
                if (!isKeySet) {
                    configIssues.push(`Anthropic API key is missing`);
                }
            } else if (provider === 'ollama') {
                // Check Ollama configuration
                const baseUrl = options.get('ollamaBaseUrl');
                if (!baseUrl) {
                    configIssues.push(`Ollama Base URL is missing`);
                }
            }
            // Add checks for other providers as needed
        }

        // Show warning if there are configuration issues
        if (configIssues.length > 0) {
            let message = '<i class="bx bx-error-circle me-2"></i><strong>AI Provider Configuration Issues</strong>';

            message += '<ul class="mb-1 ps-4">';

            // Show configuration issues
            for (const issue of configIssues) {
                message += `<li>${issue}</li>`;
            }

            message += '</ul>';
            message += '<div class="mt-2"><a href="javascript:" class="settings-link btn btn-sm btn-outline-secondary"><i class="bx bx-cog me-1"></i>Open AI Settings</a></div>';

            // Update HTML content
            validationWarning.innerHTML = message;
            validationWarning.style.display = 'block';
        } else {
            validationWarning.style.display = 'none';
        }
    } catch (error) {
        console.error('Error validating providers:', error);
        validationWarning.style.display = 'none';
    }
}
