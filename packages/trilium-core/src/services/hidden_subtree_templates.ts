import { HiddenSubtreeAttribute, HiddenSubtreeItem } from "@triliumnext/commons";
import { t } from "i18next";

export default function buildHiddenSubtreeTemplates() {
    const hideSubtreeAttributes: HiddenSubtreeAttribute = {
        name: "subtreeHidden",
        type: "label",
        value: "false"
    };

    const templates: HiddenSubtreeItem = {
        id: "_templates",
        title: t("hidden_subtree_templates.built-in-templates"),
        type: "book",
        children: [
            {
                id: "_template_text_snippet",
                type: "text",
                title: t("hidden_subtree_templates.text-snippet"),
                icon: "bx-align-left",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "textSnippet",
                        type: "label"
                    },
                    {
                        name: "label:textSnippetDescription",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.description")},single,text`
                    }
                ]
            },
            {
                id: "_template_list_view",
                type: "book",
                title: t("hidden_subtree_templates.list-view"),
                icon: "bx bx-list-ul",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "list"
                    }
                ]
            },
            {
                id: "_template_grid_view",
                type: "book",
                title: t("hidden_subtree_templates.grid-view"),
                icon: "bx bxs-grid",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "grid"
                    }
                ]
            },
            {
                id: "_template_calendar",
                type: "book",
                title: t("hidden_subtree_templates.calendar"),
                icon: "bx bx-calendar",
                attributes: [
                    {
                        name: "template",
                        type: "label",
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "calendar"
                    },
                    {
                        name: "hidePromotedAttributes",
                        type: "label"
                    },
                    hideSubtreeAttributes,
                    {
                        name: "label:startDate",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.start-date")},single,date`,
                        isInheritable: true
                    },
                    {
                        name: "label:endDate",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.end-date")},single,date`,
                        isInheritable: true
                    },
                    {
                        name: "label:startTime",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.start-time")},single,time`,
                        isInheritable: true
                    },
                    {
                        name: "label:endTime",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.end-time")},single,time`,
                        isInheritable: true
                    }
                ]
            },
            {
                id: "_template_table",
                type: "book",
                title: t("hidden_subtree_templates.table"),
                icon: "bx bx-table",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    hideSubtreeAttributes,
                    {
                        name: "viewType",
                        type: "label",
                        value: "table"
                    }
                ]
            },
            {
                id: "_template_geo_map",
                type: "book",
                title: t("hidden_subtree_templates.geo-map"),
                icon: "bx bx-map-alt",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "geoMap"
                    },
                    {
                        name: "hidePromotedAttributes",
                        type: "label"
                    },
                    hideSubtreeAttributes,
                    {
                        name: "label:geolocation",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.geolocation")},single,text`,
                        isInheritable: true
                    }
                ]
            },
            {
                id: "_template_board",
                type: "book",
                title: t("hidden_subtree_templates.board"),
                icon: "bx bx-columns",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "board"
                    },
                    {
                        name: "hidePromotedAttributes",
                        type: "label"
                    },
                    hideSubtreeAttributes,
                    {
                        name: "label:status",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.status")},single,text`,
                        isInheritable: true
                    }
                ],
                children: [
                    {
                        id: "_template_board_first",
                        title: t("hidden_subtree_templates.board_note_first"),
                        attributes: [{
                            name: "status",
                            value: t("hidden_subtree_templates.board_status_todo"),
                            type: "label"
                        }],
                        type: "text"
                    },
                    {
                        id: "_template_board_second",
                        title: t("hidden_subtree_templates.board_note_second"),
                        attributes: [{
                            name: "status",
                            value: t("hidden_subtree_templates.board_status_progress"),
                            type: "label"
                        }],
                        type: "text"
                    },
                    {
                        id: "_template_board_third",
                        title: t("hidden_subtree_templates.board_note_third"),
                        attributes: [{
                            name: "status",
                            value: t("hidden_subtree_templates.board_status_done"),
                            type: "label"
                        }],
                        type: "text"
                    }
                ]
            },
            {
                id: "_template_presentation_slide",
                type: "text",
                title: t("hidden_subtree_templates.presentation_slide"),
                icon: "bx bx-rectangle",
                attributes: [
                    {
                        name: "slide",
                        type: "label"
                    },
                    {
                        name: "label:slide:background",
                        type: "label",
                        value: `promoted,alias=${t("hidden_subtree_templates.background")},single,color`
                    }
                ]
            },
            {
                id: "_template_presentation",
                type: "book",
                title: t("hidden_subtree_templates.presentation"),
                icon: "bx bx-slideshow",
                attributes: [
                    {
                        name: "template",
                        type: "label"
                    },
                    {
                        name: "viewType",
                        type: "label",
                        value: "presentation"
                    },
                    {
                        name: "collection",
                        type: "label"
                    },
                    {
                        name: "child:template",
                        type: "relation",
                        value: "_template_presentation_slide"
                    }
                ],
                children: [
                    {
                        id: "_template_presentation_first",
                        type: "text",
                        title: t("hidden_subtree_templates.presentation_slide_first"),
                        content: t("hidden_subtree_templates.presentation_slide_first"),
                        attributes: [
                            {
                                name: "template",
                                type: "relation",
                                value: "_template_presentation_slide"
                            }
                        ]
                    },
                    {
                        id: "_template_presentation_second",
                        type: "text",
                        title: t("hidden_subtree_templates.presentation_slide_second"),
                        content: t("hidden_subtree_templates.presentation_slide_second"),
                        attributes: [
                            {
                                name: "template",
                                type: "relation",
                                value: "_template_presentation_slide"
                            }
                        ]
                    }
                ]
            }
        ]
    };

    // Enforce attributes.
    templates.enforceAttributes = true;
    for (const template of templates.children ?? []) {
        template.enforceAttributes = true;
    }

    return templates;
}
