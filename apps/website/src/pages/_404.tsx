import Section from "../components/Section";
import { usePageTitle } from "../hooks";
import "./_404.css";

export function NotFound() {
    usePageTitle("404");

	return (
		<Section title="404: Not Found" className="section-404">
            The page you were looking for could not be found. Maybe it was deleted or the URL is incorrect.
		</Section>
	);
}
