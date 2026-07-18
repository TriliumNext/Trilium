import "./Resources.css";

import { Trans, useTranslation } from "react-i18next";

import Button, { Link } from "../../components/Button";
import Card from "../../components/Card";
import Section from "../../components/Section";
import { usePageTitle } from "../../hooks";

interface IconPackMeta {
    name: string;
    file: string;
    version: string;
    website: string;
    description: string;
}

const iconPacksMeta = Object.values(import.meta.glob("../../resources/icon-packs/*.json", {
    eager: true
})) as IconPackMeta[];

export default function Resources() {
    const { t } = useTranslation();
    usePageTitle(t("resources.title"));

    return (
        <Section className="icon-packs fill">
            <h2>{t("resources.icon_packs")}</h2>

            <p>
                <Trans
                    i18nKey="resources.icon_packs_intro"
                    components={{
                        DocumentationLink: <Link href="https://docs.triliumnotes.org/user-guide/concepts/themes/icon-packs" />
                    }}
                />
            </p>

            <div className="grid-3-cols">
                {iconPacksMeta.map(meta => (
                    <Card
                        key={meta.name}
                        title={<>{meta.name} <small>{meta.version}</small></>}
                    >
                        <p className="description">{meta.description}</p>
                        <footer>
                            <Button href={`/resources/icon-packs/${encodeURIComponent(meta.file)}`} download text={t("resources.download")} />
                            <Link href={meta.website} openExternally>{t("resources.website")}</Link>
                        </footer>
                    </Card>
                ))}
            </div>
        </Section>
    );
}
