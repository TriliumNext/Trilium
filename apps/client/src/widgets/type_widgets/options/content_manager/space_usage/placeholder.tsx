import { t } from "../../../../../services/i18n";
import NoItems from "../../../../react/NoItems";

/**
 * What a view stands in with before it has anything to draw. Measuring is the usual case; a failure
 * only shows once the first request has come back empty-handed, since there is no earlier payload
 * to keep on screen then — and claiming to still be measuring would outlast the page.
 */
export default function SpaceUsagePlaceholder({ failed }: { failed: boolean }) {
    return failed
        ? <NoItems icon="bx bx-error-circle" text={t("space_usage.load_failed")} />
        : <p className="space-usage-loading">{t("space_usage.loading")}</p>;
}
