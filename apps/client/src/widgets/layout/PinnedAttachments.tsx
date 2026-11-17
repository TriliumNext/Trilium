import "./PinnedAttachments.css";

import type { ComponentType } from "preact";

import type FAttachment from "../../entities/fattachment";
import type FNote from "../../entities/fnote";
import Collapsible from "../react/Collapsible";
import { useAttachments } from "../react/hooks/note";
import { WithLazyModule } from "../react/LazyComponent";

type AttachmentComponent = ComponentType<{ attachment: FAttachment }>;

interface PinnedRole {
    View: AttachmentComponent;
    HeaderActions?: AttachmentComponent;
}

const loadTranscript = (): Promise<PinnedRole> => import("../type_widgets/transcript/TranscriptView")
    .then(({ default: View, TranscriptRecordingLevels }) => ({ View, HeaderActions: TranscriptRecordingLevels }));

/**
 * The attachment roles shown at the top of their note, each loading the view that renders it and
 * what its section's header shows beside the title.
 */
const PINNED_ROLES: Record<string, () => Promise<PinnedRole>> = {
    transcript: loadTranscript
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
                return (
                    <WithLazyModule key={attachment.attachmentId} load={PINNED_ROLES[attachment.role]}>
                        {({ View, HeaderActions }) => (
                            <Collapsible
                                className="pinned-attachment"
                                title={attachment.title}
                                headerActions={HeaderActions && <HeaderActions attachment={attachment} />}
                                card
                                initiallyExpanded
                            >
                                <View attachment={attachment} />
                            </Collapsible>
                        )}
                    </WithLazyModule>
                );
            })}
        </>
    );
}
