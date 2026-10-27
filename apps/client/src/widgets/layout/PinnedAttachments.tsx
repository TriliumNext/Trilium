import "./PinnedAttachments.css";

import type { ComponentType } from "preact";

import type FAttachment from "../../entities/fattachment";
import type FNote from "../../entities/fnote";
import Collapsible from "../react/Collapsible";
import { useAttachments } from "../react/hooks";
import TranscriptView, {
    TranscriptRecordingLevels
} from "../type_widgets/transcript/TranscriptView";

type AttachmentComponent = ComponentType<{ attachment: FAttachment }>;

interface PinnedRole {
    View: AttachmentComponent;
    HeaderActions?: AttachmentComponent;
}

/**
 * The attachment roles shown at the top of their note, each with the view that renders it and
 * what its section's header shows beside the title.
 */
const PINNED_ROLES: Record<string, PinnedRole> = {
    transcript: { View: TranscriptView, HeaderActions: TranscriptRecordingLevels }
};

/** Shows the note's attachments of a pinned role above its content, one section each. */
export default function PinnedAttachments({ note }: { note: FNote }) {
    const attachments = useAttachments(note);

    return (
        <>
            {attachments.map((attachment) => {
                if (!Object.hasOwn(PINNED_ROLES, attachment.role)) {
                    return null;
                }
                const { View, HeaderActions } = PINNED_ROLES[attachment.role];
                return (
                    <Collapsible
                        key={attachment.attachmentId}
                        className="pinned-attachment"
                        title={attachment.title}
                        headerActions={HeaderActions && <HeaderActions attachment={attachment} />}
                        card
                        initiallyExpanded
                    >
                        <View attachment={attachment} />
                    </Collapsible>
                );
            })}
        </>
    );
}
