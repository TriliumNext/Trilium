import "./content_lightbox.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import CodeBlock from "../react/CodeBlock";
import { useTriliumEvent, useTriliumOptionBool } from "../react/hooks";
import Modal from "../react/Modal";
import { RawHtmlBlock } from "../react/RawHtml";
import ZoomPanViewer, { ZOOM_PAN_HINTS } from "../react/ZoomPanViewer";

/** The payload `setupContentExpansion` in `type_widgets/text/utils.ts` sends with the command. */
export type ContentLightboxData =
    | { kind: "svg"; svg: string }
    | { kind: "html"; html: string }
    | { kind: "code"; code: string; language: string | null };

/**
 * Shows one diagram, formula or code block from a text note at full size.
 *
 * A diagram or a formula lays out at its natural size inside {@link ZoomPanViewer}, which scales it
 * to fit and lets the reader zoom and pan; code goes into the same {@link CodeBlock} the rest of the
 * UI uses, so it is highlighted and copyable.
 */
export default function ContentLightboxDialog() {
    const [ data, setData ] = useState<ContentLightboxData>();
    const [ shown, setShown ] = useState(false);
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");

    useTriliumEvent("showContentLightbox", (payload) => {
        setData(payload);
        setShown(true);
    });

    return (
        <Modal
            className="content-lightbox"
            size="xl"
            isFullPageOnMobile
            show={shown}
            onHidden={() => setShown(false)}
            scrollable={data?.kind === "code"}
            title={getTitle(data)}
        >
            {data?.kind === "code" ? (
                <CodeBlock
                    code={data.code}
                    mimeType={data.language ?? undefined}
                    copyable
                    wrap={codeBlockWordWrap}
                />
            ) : data && (
                <ZoomPanViewer fit="measure" hints={ZOOM_PAN_HINTS} viewportClassName="content-lightbox-viewport">
                    {/* Raw, not sanitized: DOMPurify strips the `<style>` and `foreignObject` a
                        mermaid diagram is drawn with, and this markup already rendered in the note. */}
                    <RawHtmlBlock
                        className="content-lightbox-content"
                        html={data.kind === "svg" ? data.svg : data.html}
                    />
                </ZoomPanViewer>
            )}
        </Modal>
    );
}

/** Names what is being shown, for the dialog header. */
function getTitle(data: ContentLightboxData | undefined) {
    switch (data?.kind) {
        case "svg":
            return t("content_lightbox.diagram_title");
        case "html":
            return t("content_lightbox.formula_title");
        case "code":
            return t("content_lightbox.code_title");
        default:
            return undefined;
    }
}
