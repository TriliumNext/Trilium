import Dropdown from "./react/Dropdown";
import "./note_icon.css";
import { t } from "i18next";
import { useNoteContext, useNoteLabel } from "./react/hooks";
import { useEffect, useRef, useState } from "preact/hooks";
import server from "../services/server";
import type { Category, Icon } from "./icon_list";
import FormTextBox from "./react/FormTextBox";
import FormSelect from "./react/FormSelect";
import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import Button from "./react/Button";

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

interface IconData {
    iconToCount: Record<string, number>;
    categories: Category[];
    icons: Icon[];
}

let fullIconData: {
    categories: Category[];
    icons: Icon[];
};
let iconToCountCache!: Promise<IconToCountCache> | null;

export default function NoteIcon() {
    const { note, viewScope } = useNoteContext();
    const [ icon, setIcon ] = useState<string | null | undefined>();
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");

    useEffect(() => {
        setIcon(note?.getIcon());
    }, [ note, iconClass, workspaceIconClass ]);

    return (
        <Dropdown
            className="note-icon-widget"
            title={t("note_icon.change_note_icon")}
            dropdownContainerStyle={{ width: "610px" }}
            buttonClassName={`note-icon ${icon ?? "bx bx-empty"}`}
            hideToggleArrow
            disabled={viewScope?.viewMode !== "default"}
        >
            { note && <NoteIconList note={note} /> }
        </Dropdown>
    )
}

function NoteIconList({ note }: { note: FNote }) {
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const [ search, setSearch ] = useState<string>();
    const [ categoryId, setCategoryId ] = useState<string>("0");
    const [ iconData, setIconData ] = useState<IconData>();

    useEffect(() => {
        async function loadIcons() {
            if (!fullIconData) {
                fullIconData = (await import("./icon_list.js")).default;
            }

            // Filter by text and/or category.
            let icons: Icon[] = fullIconData.icons;
            const processedSearch = search?.trim()?.toLowerCase();
            if (processedSearch || categoryId) {
                icons = icons.filter((icon) => {
                    if (categoryId !== "0" && String(icon.category_id) !== categoryId) {
                        return false;
                    }

                    if (processedSearch) {
                        if (!icon.name.includes(processedSearch) &&
                            !icon.term?.find((t) => t.includes(processedSearch))) {
                            return false;
                        }
                    }

                    return true;
                });
            }

            // Sort by count.
            const iconToCount = await getIconToCountMap();
            if (iconToCount) {
                icons.sort((a, b) => {
                    const countA = iconToCount[a.className ?? ""] || 0;
                    const countB = iconToCount[b.className ?? ""] || 0;

                    return countB - countA;
                });
            }

            setIconData({
                iconToCount,
                icons,
                categories: fullIconData.categories
            })
        }

        loadIcons();
    }, [ search, categoryId ]);

    return (
        <>
            <div class="filter-row">
                <span>{t("note_icon.category")}</span>
                <FormSelect
                    name="icon-category"
                    values={fullIconData?.categories ?? []}
                    currentValue={categoryId} onChange={setCategoryId}
                    keyProperty="id" titleProperty="name"
                />

                <span>{t("note_icon.search")}</span>
                <FormTextBox
                    inputRef={searchBoxRef}
                    type="text"
                    name="icon-search"
                    currentValue={search} onChange={setSearch}
                    autoFocus
                />
            </div>

            <div
                class="icon-list"
                onClick={(e) => {
                    const clickedTarget = e.target as HTMLElement;
                    
                    if (!clickedTarget.classList.contains("bx")) {
                        return;
                    }

                    const iconClass = Array.from(clickedTarget.classList.values()).join(" ");
                    if (note) {
                        const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                        attributes.setLabel(note.noteId, attributeToSet, iconClass);
                    }
                }}
            >
                {getIconLabels(note).length > 0 && (
                    <div style={{ textAlign: "center" }}>
                        <Button
                            text={t("note_icon.reset-default")}
                            onClick={() => {
                                if (!note) {
                                    return;
                                }
                                for (const label of getIconLabels(note)) {
                                    attributes.removeAttributeById(note.noteId, label.attributeId);
                                }
                            }}                    
                        />
                    </div> 
                )}

                {(iconData?.icons ?? []).map(({className, name}) => (
                    <span class={`bx ${className}`} title={name} />
                ))}
            </div>
        </>
    );
}

async function getIconToCountMap() {
    if (!iconToCountCache) {
        iconToCountCache = server.get<IconToCountCache>("other/icon-usage");
        setTimeout(() => (iconToCountCache = null), 20000); // invalidate cache after 20 seconds
    }

    return (await iconToCountCache).iconClassToCountMap;
}

function getIconLabels(note: FNote) {
    if (!note) {
        return [];
    }
    return note.getOwnedLabels()
        .filter((label) => ["workspaceIconClass", "iconClass"]
        .includes(label.name));
}