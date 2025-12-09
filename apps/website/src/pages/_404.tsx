import { useTranslation } from "react-i18next";
import Section from "../components/Section.js";
import { usePageTitle } from "../hooks.js";
import "./_404.css";

export function NotFound() {
    const { t } = useTranslation();
    usePageTitle(t("404.title"));

	return (
		<Section title={t("404.title")} className="section-404">
            {t("404.description")}
		</Section>
	);
}
