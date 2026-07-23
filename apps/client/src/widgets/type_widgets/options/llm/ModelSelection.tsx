import "./ModelSelection.css";

import type { LlmModelInfo } from "@triliumnext/commons";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import { fetchProviderModels, type ProviderModelsQuery } from "../../../../services/llm_chat";
import { formatModelCost } from "../../../../services/llm_model_cost";
import FormCheckbox from "../../../react/FormCheckbox";
import NoItems from "../../../react/NoItems";

interface ModelSelectionProps {
    /** Credentials describing the provider whose models should be listed. */
    query: ProviderModelsQuery;
    /** Currently selected models (full metadata), controlled by the parent. */
    selected: LlmModelInfo[];
    onChange: (selected: LlmModelInfo[]) => void;
    /**
     * When true, pre-select the non-legacy models on the first successful fetch
     * if nothing is selected yet — seeds a sensible default for a fresh provider.
     */
    autoSelectDefaults?: boolean;
    /**
     * Setup guidance shown alongside a listing failure. A failed fetch is the
     * moment the user needs it, so the provider passes its checklist here rather
     * than crowding the connection form with instructions nobody reads.
     */
    troubleshooting?: ComponentChildren;
}

/**
 * Fetches a provider's live model list and lets the user pick which models to
 * keep. The picked set (with full metadata) is what the chat picker later shows,
 * so no live fetch is needed during normal chatting.
 */
export default function ModelSelection({ query, selected, onChange, autoSelectDefaults, troubleshooting }: ModelSelectionProps) {
    const [models, setModels] = useState<LlmModelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | undefined>();

    // Refetch whenever the provider credentials change. A stale-guard flag drops
    // the result of a superseded request so a slow earlier fetch can't overwrite
    // a newer one.
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(undefined);
        fetchProviderModels(query)
            .then(fetched => {
                if (!active) return;
                setModels(fetched);
                setLoading(false);
                if (autoSelectDefaults && selected.length === 0 && fetched.length > 0) {
                    onChange(defaultSelectedModels(fetched));
                }
            })
            .catch(err => {
                if (!active) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });
        return () => { active = false; };
        // selected/onChange intentionally excluded: refetch tracks credentials only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query.provider, query.apiKey, query.baseURL]);

    const isSelected = useCallback((model: LlmModelInfo) => selected.some(s => s.id === model.id), [selected]);

    const toggle = useCallback((model: LlmModelInfo, checked: boolean) => {
        onChange(checked
            ? [...selected, model]
            : selected.filter(s => s.id !== model.id));
    }, [selected, onChange]);

    if (loading) {
        return <div className="model-selection-status">{t("llm.models_loading")}</div>;
    }
    if (error) {
        return (
            <NoItems icon="bx bx-error-circle" text={t("llm.models_load_failed", { error })}>
                {troubleshooting}
            </NoItems>
        );
    }
    if (models.length === 0) {
        return <NoItems icon="bx bx-bot" text={t("llm.models_none_available")}>{troubleshooting}</NoItems>;
    }

    const allSelected = models.every(isSelected);

    return (
        <div className="model-selection">
            <div className="model-selection-toolbar">
                <span className="model-selection-count">{t("llm.models_selected_count", { count: selected.length, total: models.length })}</span>
                <div className="model-selection-actions">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange(defaultSelectedModels(models))}>
                        {t("llm.models_reset_defaults")}
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange(allSelected ? [] : [...models])}>
                        {allSelected ? t("llm.models_select_none") : t("llm.models_select_all")}
                    </button>
                </div>
            </div>
            <div className="model-selection-list">
                {models.map(model => (
                    <FormCheckbox
                        key={model.id}
                        name={`model-${model.id}`}
                        currentValue={isSelected(model)}
                        onChange={checked => toggle(model, checked)}
                        label={<ModelLabel model={model} />}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * The models pre-selected by default (fresh provider, or "Reset to defaults").
 * The recommendation rule lives on the server (see isRecommendedByDefault); the
 * client just honours the `recommended` flag it tags each model with.
 */
function defaultSelectedModels(models: LlmModelInfo[]): LlmModelInfo[] {
    return models.filter(model => model.recommended);
}

/** Row label: model name plus a cost hint (per-Mtok price / subscription) when known. */
function ModelLabel({ model }: { model: LlmModelInfo }) {
    const cost = formatModelCost(model);
    return (
        <span className="model-selection-label">
            <span className="model-selection-name">{model.name}</span>
            {cost && <small className="model-selection-cost">({cost})</small>}
        </span>
    );
}
