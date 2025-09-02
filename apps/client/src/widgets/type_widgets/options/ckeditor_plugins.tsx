import { useEffect, useState, useCallback, useMemo } from "preact/hooks";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormText from "../../react/FormText";
import OptionsSection from "./components/OptionsSection";
import Button from "../../react/Button";
import toast from "../../../services/toast";
import type { 
    PluginMetadata, 
    PluginConfiguration, 
    PluginRegistry,
    PluginValidationResult,
    UpdatePluginConfigRequest,
    UpdatePluginConfigResponse,
    QueryPluginsResult,
    PluginCategory
} from "@triliumnext/commons";

interface PluginStats {
    enabled: number;
    total: number;
    core: number;
    premium: number;
    configurable: number;
    categories: Record<string, number>;
    hasPremiumLicense: boolean;
}

const CATEGORY_DISPLAY_NAMES: Record<PluginCategory, string> = {
    formatting: t("ckeditor_plugins.category_formatting"),
    structure: t("ckeditor_plugins.category_structure"),
    media: t("ckeditor_plugins.category_media"),
    tables: t("ckeditor_plugins.category_tables"),
    advanced: t("ckeditor_plugins.category_advanced"),
    trilium: t("ckeditor_plugins.category_trilium"),
    external: t("ckeditor_plugins.category_external")
};

export default function CKEditorPluginSettings() {
    const [pluginRegistry, setPluginRegistry] = useState<PluginRegistry | null>(null);
    const [userConfig, setUserConfig] = useState<PluginConfiguration[]>([]);
    const [stats, setStats] = useState<PluginStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validationResult, setValidationResult] = useState<PluginValidationResult | null>(null);
    const [showValidation, setShowValidation] = useState(false);

    // Load initial data
    useEffect(() => {
        loadData();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [registry, config, statsData] = await Promise.all([
                server.get<PluginRegistry>('ckeditor-plugins/registry'),
                server.get<PluginConfiguration[]>('ckeditor-plugins/config'),
                server.get<PluginStats>('ckeditor-plugins/stats')
            ]);
            
            setPluginRegistry(registry);
            setUserConfig(config);
            setStats(statsData);
        } catch (error) {
            toast.showError(`${t("ckeditor_plugins.load_error")}: ${error}`);
        } finally {
            setLoading(false);
        }
    }, []);

    // Organize plugins by category
    const pluginsByCategory = useMemo(() => {
        if (!pluginRegistry) return {};
        
        const categories: Record<PluginCategory, PluginMetadata[]> = {
            formatting: [],
            structure: [],
            media: [],
            tables: [],
            advanced: [],
            trilium: [],
            external: []
        };

        Object.values(pluginRegistry.plugins).forEach(plugin => {
            if (!plugin.isCore) { // Don't show core plugins in settings
                categories[plugin.category].push(plugin);
            }
        });

        // Sort plugins within each category by name
        Object.keys(categories).forEach(category => {
            categories[category as PluginCategory].sort((a, b) => a.name.localeCompare(b.name));
        });

        return categories;
    }, [pluginRegistry]);

    // Get enabled status for a plugin
    const isPluginEnabled = useCallback((pluginId: string): boolean => {
        return userConfig.find(config => config.id === pluginId)?.enabled ?? false;
    }, [userConfig]);

    // Toggle plugin enabled state
    const togglePlugin = useCallback((pluginId: string) => {
        setUserConfig(prev => prev.map(config => 
            config.id === pluginId 
                ? { ...config, enabled: !config.enabled }
                : config
        ));
    }, []);

    // Validate current configuration
    const validateConfig = useCallback(async () => {
        if (!userConfig.length) return;
        
        try {
            const result = await server.post<PluginValidationResult>('ckeditor-plugins/validate', {
                plugins: userConfig
            });
            setValidationResult(result);
            setShowValidation(true);
            return result;
        } catch (error) {
            toast.showError(`${t("ckeditor_plugins.validation_error")}: ${error}`);
            return null;
        }
    }, [userConfig]);

    // Save configuration
    const saveConfiguration = useCallback(async () => {
        setSaving(true);
        setShowValidation(false);
        
        try {
            const request: UpdatePluginConfigRequest = {
                plugins: userConfig,
                validate: true
            };

            const response = await server.put<UpdatePluginConfigResponse>('ckeditor-plugins/config', request);
            
            if (response.success) {
                toast.showMessage(t("ckeditor_plugins.save_success"));
                await loadData(); // Reload stats
                
                // Notify user that editor reload might be needed
                toast.showMessage(t("ckeditor_plugins.reload_editor_notice"), {
                    timeout: 5000
                });
            } else {
                setValidationResult(response.validation);
                setShowValidation(true);
                toast.showError(`${t("ckeditor_plugins.save_error")}: ${response.errors?.join(", ")}`);
            }
        } catch (error) {
            toast.showError(`${t("ckeditor_plugins.save_error")}: ${error}`);
        } finally {
            setSaving(false);
        }
    }, [userConfig, loadData]);

    // Reset to defaults
    const resetToDefaults = useCallback(async () => {
        if (!confirm(t("ckeditor_plugins.reset_confirm"))) return;
        
        setSaving(true);
        try {
            const response = await server.post<UpdatePluginConfigResponse>('ckeditor-plugins/reset');
            if (response.success) {
                setUserConfig(response.plugins);
                toast.showMessage(t("ckeditor_plugins.reset_success"));
                await loadData();
            } else {
                toast.showError(`${t("ckeditor_plugins.reset_error")}: ${response.errors?.join(", ")}`);
            }
        } catch (error) {
            toast.showError(`${t("ckeditor_plugins.reset_error")}: ${error}`);
        } finally {
            setSaving(false);
        }
    }, [loadData]);

    if (loading) {
        return (
            <OptionsSection title={t("ckeditor_plugins.title")}>
                <FormText>{t("ckeditor_plugins.loading")}</FormText>
            </OptionsSection>
        );
    }

    if (!pluginRegistry || !stats) {
        return (
            <OptionsSection title={t("ckeditor_plugins.title")}>
                <FormText>{t("ckeditor_plugins.load_failed")}</FormText>
                <Button text={t("ckeditor_plugins.retry")} onClick={loadData} />
            </OptionsSection>
        );
    }

    return (
        <div>
            <OptionsSection title={t("ckeditor_plugins.title")}>
                <FormText>{t("ckeditor_plugins.description")}</FormText>
                
                {/* Stats overview */}
                <div className="plugin-stats" style={{ 
                    backgroundColor: 'var(--accented-background-color)', 
                    padding: '12px', 
                    borderRadius: '4px',
                    marginBottom: '20px'
                }}>
                    <div className="row">
                        <div className="col-md-3">
                            <strong>{t("ckeditor_plugins.stats_enabled")}</strong><br />
                            <span style={{ fontSize: '1.2em', color: 'var(--main-text-color)' }}>
                                {stats.enabled}/{stats.configurable}
                            </span>
                        </div>
                        <div className="col-md-3">
                            <strong>{t("ckeditor_plugins.stats_total")}</strong><br />
                            <span style={{ fontSize: '1.2em', color: 'var(--main-text-color)' }}>
                                {stats.total}
                            </span>
                        </div>
                        <div className="col-md-3">
                            <strong>{t("ckeditor_plugins.stats_core")}</strong><br />
                            <span style={{ fontSize: '1.2em', color: 'var(--main-text-color)' }}>
                                {stats.core}
                            </span>
                        </div>
                        <div className="col-md-3">
                            <strong>{t("ckeditor_plugins.stats_premium")}</strong><br />
                            <span style={{ fontSize: '1.2em', color: stats.hasPremiumLicense ? 'var(--success-color)' : 'var(--muted-text-color)' }}>
                                {stats.premium} {!stats.hasPremiumLicense && `(${t("ckeditor_plugins.no_license")})`}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Validation results */}
                {showValidation && validationResult && (
                    <div className="validation-results" style={{ marginBottom: '20px' }}>
                        {!validationResult.valid && (
                            <div className="alert alert-danger">
                                <strong>{t("ckeditor_plugins.validation_errors")}</strong>
                                <ul>
                                    {validationResult.errors.map((error, index) => (
                                        <li key={index}>{error.message}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {validationResult.warnings.length > 0 && (
                            <div className="alert alert-warning">
                                <strong>{t("ckeditor_plugins.validation_warnings")}</strong>
                                <ul>
                                    {validationResult.warnings.map((warning, index) => (
                                        <li key={index}>{warning.message}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div className="plugin-actions" style={{ marginBottom: '20px' }}>
                    <Button 
                        text={t("ckeditor_plugins.validate")} 
                        onClick={validateConfig}
                        disabled={saving}
                        className="btn-secondary"
                        size="small"
                    />
                    <Button 
                        text={t("ckeditor_plugins.save")} 
                        onClick={saveConfiguration}
                        disabled={saving}
                        className="btn-primary"
                        size="small"
                        style={{ marginLeft: '10px' }}
                    />
                    <Button 
                        text={t("ckeditor_plugins.reset_defaults")} 
                        onClick={resetToDefaults}
                        disabled={saving}
                        className="btn-secondary"
                        size="small"
                        style={{ marginLeft: '10px' }}
                    />
                </div>
            </OptionsSection>

            {/* Plugin categories */}
            {Object.entries(pluginsByCategory).map(([categoryKey, plugins]) => {
                if (plugins.length === 0) return null;
                
                const category = categoryKey as PluginCategory;
                return (
                    <OptionsSection key={category} title={CATEGORY_DISPLAY_NAMES[category]} level={2}>
                        <div className="plugin-category">
                            {plugins.map(plugin => (
                                <PluginConfigItem 
                                    key={plugin.id}
                                    plugin={plugin}
                                    enabled={isPluginEnabled(plugin.id)}
                                    onToggle={() => togglePlugin(plugin.id)}
                                    hasPremiumLicense={stats.hasPremiumLicense}
                                />
                            ))}
                        </div>
                    </OptionsSection>
                );
            })}
        </div>
    );
}

interface PluginConfigItemProps {
    plugin: PluginMetadata;
    enabled: boolean;
    onToggle: () => void;
    hasPremiumLicense: boolean;
}

function PluginConfigItem({ plugin, enabled, onToggle, hasPremiumLicense }: PluginConfigItemProps) {
    const canEnable = !plugin.requiresPremium || hasPremiumLicense;
    
    return (
        <FormGroup name={`plugin-${plugin.id}`} style={{ marginBottom: '15px' }}>
            <div className="plugin-item" style={{
                display: 'flex',
                alignItems: 'flex-start',
                opacity: canEnable ? 1 : 0.6
            }}>
                <FormCheckbox
                    label=""
                    currentValue={enabled && canEnable}
                    onChange={canEnable ? onToggle : undefined}
                    disabled={!canEnable}
                    containerStyle={{ marginRight: '10px', marginTop: '2px' }}
                />
                <div style={{ flex: 1 }}>
                    <div style={{ 
                        fontWeight: 'bold',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span>{plugin.name}</span>
                        {plugin.requiresPremium && (
                            <span className="badge badge-warning" style={{ fontSize: '0.75em' }}>
                                {t("ckeditor_plugins.premium")}
                            </span>
                        )}
                        {plugin.dependencies.length > 0 && (
                            <span className="badge badge-info" style={{ fontSize: '0.75em' }}>
                                {t("ckeditor_plugins.has_dependencies")}
                            </span>
                        )}
                    </div>
                    <div style={{ 
                        fontSize: '0.9em', 
                        color: 'var(--muted-text-color)',
                        marginBottom: '4px'
                    }}>
                        {plugin.description}
                    </div>
                    {plugin.dependencies.length > 0 && (
                        <div style={{ fontSize: '0.8em', color: 'var(--muted-text-color)' }}>
                            {t("ckeditor_plugins.depends_on")}: {plugin.dependencies.join(', ')}
                        </div>
                    )}
                    {plugin.toolbarItems && plugin.toolbarItems.length > 0 && (
                        <div style={{ fontSize: '0.8em', color: 'var(--muted-text-color)' }}>
                            {t("ckeditor_plugins.toolbar_items")}: {plugin.toolbarItems.join(', ')}
                        </div>
                    )}
                    {!canEnable && (
                        <div style={{ 
                            fontSize: '0.8em', 
                            color: 'var(--error-color)',
                            fontStyle: 'italic'
                        }}>
                            {t("ckeditor_plugins.premium_required")}
                        </div>
                    )}
                </div>
            </div>
        </FormGroup>
    );
}