import { evaluateTemplate, type TemplateVariables } from "@triliumnext/commons";

import { getLog } from "./log.js";

/**
 * Convenience wrapper that evaluates a template and catches errors,
 * logging them and returning the fallback value.
 */
export function evaluateTemplateSafe(
    template: string,
    variables: TemplateVariables,
    fallback: string,
    contextDescription: string
): string {
    try {
        return evaluateTemplate(template, variables);
    } catch (e: any) {
        getLog().error(`Template evaluation for ${contextDescription} failed with: ${e.message}`);
        return fallback;
    }
}
