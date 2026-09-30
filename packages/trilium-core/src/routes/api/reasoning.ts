import type { Request } from "../../http_interface.js";
import { getReasoningReport, runReasoning } from "../../services/reasoning/reasoning.js";

function getReasoning(_req: Request) {
    return getReasoningReport();
}

function run(_req: Request) {
    return runReasoning();
}

export default {
    getReasoning,
    run
};
