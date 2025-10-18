import Section from "../components/Section.js";
import { usePageTitle } from "../hooks.js";
import { t } from "../i18n.js";
import "./_404.css";

export function NotFound() {
    usePageTitle(t("404.title"));

	return (
		<Section title={t("404.title")} className="section-404">
            {t("404.description")}
		</Section>
	);
}
