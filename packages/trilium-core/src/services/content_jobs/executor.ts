import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";

import optionService from "../options.js";
import { getTaskStates } from "../task_states.js";
import { setContentJobEnvProvider } from "./env.js";
import { type ContentJob, type ContentJobResult, runContentJob } from "./jobs.js";

/** Runs content jobs, in this thread by default or in worker processes on the Node runtimes. */
export interface ContentJobExecutor {
    run<J extends ContentJob>(job: J): Promise<ContentJobResult<J>>;
    /** How many jobs run at once; sizes the backlog an import keeps ahead of its saves. */
    readonly concurrency?: number;
}

const inProcessExecutor: ContentJobExecutor = {
    run: (job) => runContentJob(job)
};

let executor: ContentJobExecutor = inProcessExecutor;

/**
 * Sets the executor that import, export and the office preview send their conversions to, or
 * restores the in-process one. Also points the converters' default settings at the live
 * `allowedHtmlTags` option and task states, which only the thread that owns becca can read.
 */
export function initContentJobExecutor(customExecutor?: ContentJobExecutor) {
    executor = customExecutor ?? inProcessExecutor;
    setContentJobEnvProvider({
        allowedHtmlTags: readAllowedHtmlTags,
        taskStates: getTaskStates
    });
}

export function getContentJobExecutor(): ContentJobExecutor {
    return executor;
}

function readAllowedHtmlTags(): readonly string[] {
    try {
        return JSON.parse(optionService.getOption("allowedHtmlTags"));
    } catch {
        // The option is missing (before the database is initialized) or not valid JSON.
        return SANITIZER_DEFAULT_ALLOWED_TAGS;
    }
}
