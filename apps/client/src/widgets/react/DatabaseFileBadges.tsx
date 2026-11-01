import "./DatabaseFileBadges.css";

import { Badge } from "./Badge";

/**
 * The labels that tell one database file apart from another at a glance: the format it was written
 * in, and anything else worth saying about where it came from.
 *
 * Shared by every list of these files — the backups in the options, the ones the setup screen offers
 * to restore from — so that a badge looks and reads the same wherever a file is shown.
 */
export default function DatabaseFileBadges({ badges }: { badges: string[] }) {
    return (
        <>
            {badges.map((badge) => (
                <Badge key={badge} className="database-file-badge" text={badge} outline />
            ))}
        </>
    );
}
