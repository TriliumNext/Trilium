import { DEFAULT_TASK_STATES, SANITIZER_DEFAULT_ALLOWED_TAGS, type TaskStateDef } from "@triliumnext/commons";

/**
 * The settings a content conversion reads from the database, captured on the thread that owns
 * becca so that a conversion can run anywhere. Structured-clone safe.
 */
export interface ContentJobEnv {
    allowedHtmlTags: string[];
    taskStates: TaskStateDef[];
}

/** Reads the live settings; registered by `initContentJobExecutor()` on the thread that owns becca. */
export interface ContentJobEnvProvider {
    allowedHtmlTags(): readonly string[];
    taskStates(): TaskStateDef[];
}

let provider: ContentJobEnvProvider | null = null;

/** Captures the current settings once, for every conversion of one import or export run. */
export function captureContentJobEnv(): ContentJobEnv {
    return {
        allowedHtmlTags: [ ...getDefaultAllowedHtmlTags() ],
        taskStates: getDefaultTaskStates()
    };
}

export function setContentJobEnvProvider(newProvider: ContentJobEnvProvider | null) {
    provider = newProvider;
}

/**
 * The tags `sanitizeHtml()` keeps when its caller passes none. Without a registered provider (a
 * worker process, or before core is initialized) this is the built-in default list.
 */
export function getDefaultAllowedHtmlTags(): readonly string[] {
    return provider ? provider.allowedHtmlTags() : SANITIZER_DEFAULT_ALLOWED_TAGS;
}

/** The task states the Markdown converters use when their caller passes none. */
export function getDefaultTaskStates(): TaskStateDef[] {
    return provider ? provider.taskStates() : DEFAULT_TASK_STATES;
}
