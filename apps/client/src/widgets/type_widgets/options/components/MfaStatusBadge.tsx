import "./MfaStatusBadge.css";

import { Badge } from "../../../react/Badge";

/** Visual tone of an MFA status badge: a live method, one configured but not yet bound, or an off one. */
export type MfaStatusTone = "active" | "pending" | "inactive";

const TONE_ICON: Record<MfaStatusTone, string> = {
    active: "bx bx-check",
    pending: "bx bx-link",
    inactive: "bx bx-x"
};

/**
 * Status badge shared by the sign-in method cards (OpenID Connect, TOTP): a colored outline whose hue
 * and icon are driven by `tone` — green when the method is active, amber when it's configured but not
 * yet bound, muted when it's off. Wrap it in a `.mfa-status-title` span to sit inline after a section title.
 */
export default function MfaStatusBadge({ tone, text }: { tone: MfaStatusTone, text: string }) {
    return <Badge className={`mfa-status-badge ${tone}`} icon={TONE_ICON[tone]} text={text} outline />;
}
