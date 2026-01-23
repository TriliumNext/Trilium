import type { ParsedToolArguments } from './tool_interfaces.js';

function sanitizeJsonArgument(value: string): string {
    return value
        .replace(/^['"]/g, '')
        .replace(/['"]$/g, '')
        .replace(/\\"/g, '"')
        .replace(/([{,])\s*'([^']+)'\s*:/g, '$1"$2":')
        .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');
}

export function parseToolArguments(input: string | Record<string, unknown>): ParsedToolArguments {
    const warnings: string[] = [];

    if (typeof input === 'object' && input !== null) {
        return { args: input, warnings };
    }

    if (typeof input !== 'string') {
        warnings.push('Tool arguments were not a string or object; defaulting to empty object.');
        return { args: {}, warnings };
    }

    if (input.trim() === '') {
        warnings.push('Tool arguments were an empty string; defaulting to empty object.');
        return { args: {}, warnings };
    }

    try {
        const parsed = JSON.parse(input) as Record<string, unknown>;
        return { args: parsed, warnings };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to parse arguments as JSON: ${message}`);
    }

    try {
        const cleaned = sanitizeJsonArgument(input);
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        warnings.push('Parsed arguments after sanitizing malformed JSON.');
        return { args: parsed, warnings };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to parse sanitized arguments: ${message}`);
    }

    warnings.push('Falling back to text argument payload.');
    return { args: { text: input }, warnings };
}
