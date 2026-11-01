/**
 * The user's approval of the tool calls a chat turn makes.
 *
 * A turn holds its tool calls until the user answers them: `runChat()` opens a
 * {@link ToolApprovals} under the turn's stream id, the provider asks it about every
 * call through the AI SDK's `toolApproval` option, and the answer arrives through
 * `POST /api/llm-chat/tool-approval`, which looks the turn up by that id. Waiting
 * inside the turn keeps the conversation history free of tool calls, which the
 * client does not send back.
 */

import type { LlmPermissionMode, LlmToolApprovalAnswer, LlmToolApprovalRequest } from "@triliumnext/commons";

import type { ToolKind } from "./tools/index.js";

/** The reason the model is given for a call the user declined. */
export const TOOL_CALL_DECLINED_REASON = "The user declined this tool call.";

/** What decides which calls of a turn wait for the user. */
export interface ToolApprovalPolicy {
    /** The tools the chat allowed, whose calls run without asking. */
    allowedTools?: Iterable<string>;
    /** Absent means `"always_ask"`. */
    mode?: LlmPermissionMode;
    /**
     * What a tool's calls touch. `"app_content"` and `"web"` never ask, and `"ask_before_changes"`
     * lets `"read"` run too. Absent, every tool counts as a change.
     */
    kindOf?: (toolName: string) => ToolKind;
}

/** The tool calls of one turn that wait for the user's answer. */
export class ToolApprovals {
    private readonly pending = new Map<string, { toolName: string; settle: (approved: boolean) => void }>();
    /** The tools whose calls run without asking. */
    private readonly allowedTools: Set<string>;
    private readonly mode: LlmPermissionMode;
    private readonly kindOf: (toolName: string) => ToolKind;
    /** Called with every request, so the turn can pass it on to the client. */
    onRequest?: (request: LlmToolApprovalRequest) => void;

    constructor(private readonly abortSignal?: AbortSignal, policy: ToolApprovalPolicy = {}) {
        this.allowedTools = new Set(policy.allowedTools);
        this.mode = policy.mode ?? "always_ask";
        this.kindOf = policy.kindOf ?? (() => "change");
    }

    /**
     * Ask the user about a tool call. Resolves to whether it was approved; a turn that
     * is stopped, or ends, before the user answers declines the call. A call the permission
     * mode lets through, or of a tool the chat allowed, is approved without asking.
     */
    request(request: LlmToolApprovalRequest): Promise<boolean> {
        if (this.abortSignal?.aborted) {
            return Promise.resolve(false);
        }
        if (this.runsUnasked(request.toolName)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const settle = (approved: boolean) => {
                this.pending.delete(request.toolCallId);
                this.abortSignal?.removeEventListener("abort", onAbort);
                resolve(approved);
            };
            const onAbort = () => settle(false);
            this.abortSignal?.addEventListener("abort", onAbort, { once: true });
            this.pending.set(request.toolCallId, { toolName: request.toolName, settle });
            this.onRequest?.(request);
        });
    }

    /**
     * Settle a pending call. Approved with the `"chat"` scope, its tool is allowed from then on,
     * and the other calls of it that wait are approved too. Returns `false` when no call with
     * that id is waiting.
     */
    answer(toolCallId: string, approved: boolean, scope?: LlmToolApprovalAnswer["scope"]): boolean {
        const call = this.pending.get(toolCallId);
        if (!call) {
            return false;
        }
        call.settle(approved);
        if (approved && scope === "chat") {
            this.allowedTools.add(call.toolName);
            for (const waiting of [ ...this.pending.values() ]) {
                if (waiting.toolName === call.toolName) {
                    waiting.settle(true);
                }
            }
        }
        return true;
    }

    private runsUnasked(toolName: string): boolean {
        if (this.mode === "dont_ask" || this.allowedTools.has(toolName)) {
            return true;
        }
        const kind = this.kindOf(toolName);
        return kind === "app_content" || kind === "web"
            || (kind === "read" && this.mode === "ask_before_changes");
    }

    /** Decline every call that still waits. */
    declineAll(): void {
        for (const { settle } of [ ...this.pending.values() ]) {
            settle(false);
        }
    }
}

const openApprovals = new Map<string, ToolApprovals>();

/**
 * Open the approvals of a turn under its stream id. Returns `undefined` when a turn with that id
 * is already running.
 */
export function openToolApprovals(
    streamId: string,
    abortSignal?: AbortSignal,
    policy?: ToolApprovalPolicy
): ToolApprovals | undefined {
    if (openApprovals.has(streamId)) {
        return undefined;
    }
    const approvals = new ToolApprovals(abortSignal, policy);
    openApprovals.set(streamId, approvals);
    return approvals;
}

/** Close the approvals of a finished turn, declining whatever still waits. */
export function closeToolApprovals(streamId: string): void {
    openApprovals.get(streamId)?.declineAll();
    openApprovals.delete(streamId);
}

/**
 * Pass on the user's answer to a tool call. Returns `false` when the turn has ended or the call
 * was already answered.
 */
export function answerToolApproval(
    streamId: string,
    toolCallId: string,
    approved: boolean,
    scope?: LlmToolApprovalAnswer["scope"]
): boolean {
    return openApprovals.get(streamId)?.answer(toolCallId, approved, scope) ?? false;
}
