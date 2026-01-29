import "./PlatformIndicator.css";

import { useRef } from "preact/hooks";

import { t } from "../../../../services/i18n";
import { useStaticTooltip } from "../../../react/hooks";
import Icon from "../../../react/Icon";

interface PlatformIndicatorProps {
    windows?: boolean | "11";
    mac: boolean;
}

export default function PlatformIndicator({ windows, mac }: PlatformIndicatorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    useStaticTooltip(containerRef, {
        selector: "span",
        animation: false,
        title() { return this.title; },
    });

    return (
        <div ref={containerRef} className="platform-indicator">
            {windows && <Icon
                icon="bx bxl-windows"
                title={t("platform_indicator.available_on", { platform: windows === "11" ? "Windows 11" : "Windows" })}
            />}
            {mac && <Icon
                icon="bx bxl-apple"
                title={t("platform_indicator.available_on", { platform: "macOS" })}
            />}
        </div>
    );
}
