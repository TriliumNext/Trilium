import "./index.css";

import { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Trans, useTranslation } from 'react-i18next';

import calendarIcon from "../../assets/boxicons/bx-calendar.svg?raw";
import hoistingIcon from "../../assets/boxicons/bx-chevrons-up.svg?raw";
import codeIcon from "../../assets/boxicons/bx-code.svg?raw";
import boardIcon from "../../assets/boxicons/bx-columns-3.svg?raw";
import dockerIcon from "../../assets/boxicons/bx-docker.svg?raw";
import restApiIcon from "../../assets/boxicons/bx-extension.svg?raw";
import fileIcon from "../../assets/boxicons/bx-file.svg?raw";
import noteStructureIcon from "../../assets/boxicons/bx-folder.svg?raw";
import gitHubIcon from "../../assets/boxicons/bx-github.svg?raw";
import shareIcon from "../../assets/boxicons/bx-globe.svg?raw";
import revisionsIcon from "../../assets/boxicons/bx-history.svg?raw";
import geomapIcon from "../../assets/boxicons/bx-map.svg?raw";
import mindmapIcon from "../../assets/boxicons/bx-network-chart.svg?raw";
import textNoteIcon from "../../assets/boxicons/bx-note.svg?raw";
import webClipperIcon from "../../assets/boxicons/bx-paperclip.svg?raw";
import canvasIcon from "../../assets/boxicons/bx-pen.svg?raw";
import syncIcon from "../../assets/boxicons/bx-refresh-cw.svg?raw";
import searchIcon from "../../assets/boxicons/bx-search.svg?raw";
import jumpToIcon from "../../assets/boxicons/bx-send-alt.svg?raw";
import protectedNotesIcon from "../../assets/boxicons/bx-shield.svg?raw";
import presentationIcon from "../../assets/boxicons/bx-slideshow.svg?raw";
import importExportIcon from "../../assets/boxicons/bx-swap-horizontal.svg?raw";
import tableIcon from "../../assets/boxicons/bx-table.svg?raw";
import attributesIcon from "../../assets/boxicons/bx-tag.svg?raw";
import mermaidIcon from "../../assets/boxicons/bx-vector-square.svg?raw";
import Button, { Link } from '../../components/Button.js';
import Card from '../../components/Card.js';
import DownloadButton from '../../components/DownloadButton.js';
import Section from '../../components/Section.js';
import { getPlatform } from '../../download-helper.js';
import { useColorScheme, usePageTitle } from '../../hooks.js';

export function Home() {
    usePageTitle("");

    return (
        <>
            <HeroSection />
            <OrganizationBenefitsSection />
            <ProductivityBenefitsSection />
            <NoteTypesSection />
            <ExtensibilityBenefitsSection />
            <CollectionsSection />
            <FaqSection />
            <FinalCta />
        </>
    );
}

function HeroSection() {
    const { t } = useTranslation();
    const platform = getPlatform();
    const colorScheme = useColorScheme();
    const [ screenshotUrl, setScreenshotUrl ] = useState<string>();

    useEffect(() => {
        switch (platform) {
            case "macos":
                setScreenshotUrl(`/screenshot_desktop_mac_${colorScheme}.webp`);
                break;
            case "linux":
                setScreenshotUrl(`/screenshot_desktop_linux_${colorScheme}.webp`);
                break;
            case "windows":
            default:
                setScreenshotUrl(`/screenshot_desktop_win_${colorScheme}.webp`);
                break;
        }
    }, [ colorScheme ]);

    return (
        <Section className="hero-section">
            <div class="title-section">
                <h1>{t("hero_section.title")}</h1>
                <p>{t("hero_section.subtitle")}</p>

                <div className="download-wrapper">
                    <DownloadButton big />
                    <Button href="./get-started/" className="mobile-only" text={t("hero_section.get_started")} />
                    <div className="additional-options">
                        <Button iconSvg={gitHubIcon} outline text={t("hero_section.github")} href="https://github.com/TriliumNext/Trilium/" openExternally />
                        <Button iconSvg={dockerIcon} outline text={t("hero_section.dockerhub")} href="https://hub.docker.com/r/triliumnext/trilium" openExternally />
                    </div>
                </div>

            </div>

            <div className="screenshot-container">
                {screenshotUrl && <img class="screenshot" src={screenshotUrl} alt={t("hero_section.screenshot_alt")} />}
            </div>
        </Section>
    );
}

function OrganizationBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section className="benefits" title={t("organization_benefits.title")}>
                <div className="benefits-container grid-3-cols">
                    <Card iconSvg={noteStructureIcon} title={t("organization_benefits.note_structure_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes">{t("organization_benefits.note_structure_description")}</Card>
                    <Card iconSvg={attributesIcon} title={t("organization_benefits.attributes_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/attributes">{t("organization_benefits.attributes_description")}</Card>
                    <Card iconSvg={hoistingIcon} title={t("organization_benefits.hoisting_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting">{t("organization_benefits.hoisting_description")}</Card>
                </div>
            </Section>
        </>
    );
}

function ProductivityBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section className="benefits accented" title={t("productivity_benefits.title")}>
                <div className="benefits-container grid-3-cols">
                    <Card iconSvg={revisionsIcon} title={t("productivity_benefits.revisions_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions">{t("productivity_benefits.revisions_content")}</Card>
                    <Card iconSvg={syncIcon} title={t("productivity_benefits.sync_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/setup/synchronization">{t("productivity_benefits.sync_content")}</Card>
                    <Card iconSvg={protectedNotesIcon} title={t("productivity_benefits.protected_notes_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes">{t("productivity_benefits.protected_notes_content")}</Card>
                    <Card iconSvg={jumpToIcon} title={t("productivity_benefits.jump_to_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/navigation/jump-to">{t("productivity_benefits.jump_to_content")}</Card>
                    <Card iconSvg={searchIcon} title={t("productivity_benefits.search_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/navigation/search">{t("productivity_benefits.search_content")}</Card>
                    <Card iconSvg={webClipperIcon} title={t("productivity_benefits.web_clipper_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/setup/web-clipper">{t("productivity_benefits.web_clipper_content")}</Card>
                </div>
            </Section>
        </>
    );
}

function NoteTypesSection() {
    const { t } = useTranslation();
    return (
        <Section className="note-types" title={t("note_types.title")}>
            <ListWithScreenshot items={[
                {
                    title: t("note_types.text_title"),
                    imageUrl: "/type_text.webp",
                    iconSvg: textNoteIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/text",
                    description: t("note_types.text_description")
                },
                {
                    title: t("note_types.code_title"),
                    imageUrl: "/type_code.webp",
                    iconSvg: codeIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/code",
                    description: t("note_types.code_description")
                },
                {
                    title: t("note_types.file_title"),
                    imageUrl: "/type_file.webp",
                    iconSvg: fileIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/file",
                    description: t("note_types.file_description")
                },
                {
                    title: t("note_types.canvas_title"),
                    imageUrl: "/type_canvas.webp",
                    iconSvg: canvasIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/canvas",
                    description: t("note_types.canvas_description")
                },
                {
                    title: t("note_types.mermaid_title"),
                    imageUrl: "/type_mermaid.webp",
                    iconSvg: mermaidIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mermaid-diagrams",
                    description: t("note_types.mermaid_description")
                },
                {
                    title: t("note_types.mindmap_title"),
                    imageUrl: "/type_mindmap.webp",
                    iconSvg: mindmapIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mindmap",
                    description: t("note_types.mindmap_description")
                }
            ]} />
            <p>
                <Trans
                    i18nKey="note_types.others_list"
                    components={[
                        <Link href="https://docs.triliumnotes.org/user-guide/note-types/note-map" openExternally />,
                        <Link href="https://docs.triliumnotes.org/user-guide/note-types/relation-map" openExternally />,
                        <Link href="https://docs.triliumnotes.org/user-guide/note-types/saved-search" openExternally />,
                        <Link href="https://docs.triliumnotes.org/user-guide/note-types/render-note" openExternally />,
                        <Link href="https://docs.triliumnotes.org/user-guide/note-types/webview" openExternally />
                    ]}
                />
            </p>
        </Section>
    );
}

function ExtensibilityBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section className="benefits accented" title={t("extensibility_benefits.title")}>
                <div className="benefits-container grid-4-cols">
                    <Card iconSvg={importExportIcon} title={t("extensibility_benefits.import_export_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/import-export">{t("extensibility_benefits.import_export_description")}</Card>
                    <Card iconSvg={shareIcon} title={t("extensibility_benefits.share_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/sharing">{t("extensibility_benefits.share_description")}</Card>
                    <Card iconSvg={codeIcon} title={t("extensibility_benefits.scripting_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/scripts">{t("extensibility_benefits.scripting_description")}</Card>
                    <Card iconSvg={restApiIcon} title={t("extensibility_benefits.api_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/etapi">{t("extensibility_benefits.api_description")}</Card>
                </div>
            </Section>
        </>
    );
}

function CollectionsSection() {
    const { t } = useTranslation();
    return (
        <Section className="collections" title={t("collections.title")}>
            <ListWithScreenshot items={[
                {
                    title: t("collections.calendar_title"),
                    imageUrl: "/collection_calendar.webp",
                    iconSvg: calendarIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/calendar",
                    description: t("collections.calendar_description")
                },
                {
                    title: t("collections.table_title"),
                    iconSvg: tableIcon,
                    imageUrl: "/collection_table.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/table",
                    description: t("collections.table_description")
                },
                {
                    title: t("collections.board_title"),
                    iconSvg: boardIcon,
                    imageUrl: "/collection_board.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/kanban-board",
                    description: t("collections.board_description")
                },
                {
                    title: t("collections.geomap_title"),
                    iconSvg: geomapIcon,
                    imageUrl: "/collection_geomap.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/geomap",
                    description: t("collections.geomap_description")
                },
                {
                    title: t("collections.presentation_title"),
                    iconSvg: presentationIcon,
                    imageUrl: "/collection_presentation.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/presentation",
                    description: t("collections.presentation_description")
                }
            ]} />
        </Section>
    );
}

function ListWithScreenshot({ items, cardExtra }: {
    items: { title: string, imageUrl: string, description: string, moreInfo: string, iconSvg?: string }[];
    cardExtra?: ComponentChildren;
}) {
    return (
        <div className={`list-with-screenshot`}>
            <ul>
                {items.map(item => (
                    <li>
                        <Card
                            title={item.title}
                            moreInfoUrl={item.moreInfo}
                            iconSvg={item.iconSvg}
                            imageUrl={item.imageUrl}
                        >
                            {item.description}
                        </Card>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FaqSection() {
    const { t } = useTranslation();
    return (
        <Section className="faq" title={t("faq.title")}>
            <div class="grid-2-cols">
                <FaqItem question={t("faq.mobile_question")}>{t("faq.mobile_answer")}</FaqItem>
                <FaqItem question={t("faq.database_question")}>{t("faq.database_answer")}</FaqItem>
                <FaqItem question={t("faq.server_question")}>{t("faq.server_answer")}</FaqItem>
                <FaqItem question={t("faq.scaling_question")}>{t("faq.scaling_answer")}</FaqItem>
                <FaqItem question={t("faq.network_share_question")}>{t("faq.network_share_answer")}</FaqItem>
                <FaqItem question={t("faq.security_question")}>{t("faq.security_answer")}</FaqItem>
            </div>
        </Section>
    );
}

function FaqItem({ question, children }: { question: string; children: ComponentChildren }) {
    return (
        <Card title={question}>
            {children}
        </Card>
    );
}

function FinalCta() {
    const { t } = useTranslation();
    return (
        <Section className="final-cta accented" title={t("final_cta.title")}>
            <p>{t("final_cta.description")}</p>

            <div class="buttons">
                <Button href="./get-started/" text={t("final_cta.get_started")} />
            </div>
        </Section>
    );
}
