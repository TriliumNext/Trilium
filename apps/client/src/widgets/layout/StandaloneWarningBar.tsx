import { useRef } from "preact/hooks";
import { t } from "../../services/i18n";
import { useNoteContext, useTooltip } from "../react/hooks";
import "./StandaloneWarningBar.css";

type WarningBarVariant = "standalone" | "mobile";

interface WarningBarProps {
    variant?: WarningBarVariant;
}

export default function StandaloneWarningBar({ variant = "standalone" }: WarningBarProps) {
    const { noteContext } = useNoteContext();
    const badgeRef = useRef<HTMLDivElement>(null);

    useTooltip(badgeRef, {
        title: t(`${variant}.warning_tooltip`),
        placement: "top",
        delay: 200
    });

    // Only show in the main split, not sub-splits.
    if (noteContext?.mainNtxId) {
        return null;
    }

    return (
        <div ref={badgeRef} className="standalone-badge">
            <span className="bx bx-error-circle" />
            <span className="standalone-badge-text">{t(`${variant}.badge_label`)}</span>
        </div>
    );
}
