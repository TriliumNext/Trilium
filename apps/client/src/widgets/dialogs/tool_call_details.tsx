import "./tool_call_details.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import CodeBlock from "../react/CodeBlock";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import type { ToolCall } from "../type_widgets/llm_chat/llm_chat_types";

/**
 * Shows the raw input and result of an LLM tool call. Summon it with
 * `appContext.triggerEvent("showToolCallDetails", { toolCall })`.
 */
export default function ToolCallDetailsDialog() {
    const [ toolCall, setToolCall ] = useState<ToolCall>();
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showToolCallDetails", ({ toolCall }) => {
        setToolCall(toolCall);
        setShown(true);
    });

    const title = toolCall && (
        <h5 className="modal-title">
            {t(`llm.tools.${toolCall.toolName}`, { defaultValue: toolCall.toolName })}
            <code className="tool-call-details-name">{toolCall.toolName}</code>
        </h5>
    );

    return (
        <Modal
            className="tool-call-details-dialog"
            title={title}
            size="lg"
            scrollable
            show={shown}
            onHidden={() => setShown(false)}
        >
            {toolCall && (
                <>
                    <section className="tool-call-details-section">
                        <h6>{t("llm_chat.input")}</h6>
                        {toolCall.inputStreaming !== undefined
                            ? <CodeBlock code={toolCall.inputStreaming} wrap />
                            : <CodeBlock code={JSON.stringify(toolCall.input, null, 2)} mimeType="application/json" wrap />}
                    </section>
                    <section className="tool-call-details-section">
                        <h6>{toolCall.isError ? t("llm_chat.error") : t("llm_chat.result")}</h6>
                        {toolCall.result
                            ? <ResultBlock result={toolCall.result} />
                            : <p className="tool-call-details-empty">{t("llm_chat.tool_call_no_result")}</p>}
                    </section>
                </>
            )}
        </Modal>
    );
}

/** A JSON result pretty-printed and highlighted; any other result as plain text. */
function ResultBlock({ result }: { result: string }) {
    try {
        const parsed: unknown = JSON.parse(result);
        return <CodeBlock code={JSON.stringify(parsed, null, 2)} mimeType="application/json" wrap />;
    } catch {
        return <CodeBlock code={result} wrap />;
    }
}
