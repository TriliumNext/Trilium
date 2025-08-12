/**
 * Metrics Export System for LLM Service
 * 
 * Provides unified metrics collection and export to various monitoring systems:
 * - Prometheus format endpoint
 * - StatsD/DataDog format
 * - OpenTelemetry format
 */

import log from '../../log.js';
import { EventEmitter } from 'events';
import type { ProviderType } from '../providers/provider_factory.js';

/**
 * Metric types
 */
export enum MetricType {
    COUNTER = 'counter',
    GAUGE = 'gauge',
    HISTOGRAM = 'histogram',
    SUMMARY = 'summary'
}

/**
 * Metric data point
 */
export interface MetricDataPoint {
    name: string;
    type: MetricType;
    value: number;
    timestamp: Date;
    labels: Record<string, string>;
    unit?: string;
    description?: string;
}

/**
 * Provider metrics
 */
export interface ProviderMetrics {
    provider: string;
    requests: number;
    failures: number;
    successRate: number;
    averageLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    averageTokensPerRequest: number;
    errorRate: number;
    lastError?: string;
    lastUpdated: Date;
}

/**
 * System metrics
 */
export interface SystemMetrics {
    totalRequests: number;
    totalFailures: number;
    averageLatency: number;
    activePipelines: number;
    cacheHitRate: number;
    memoryUsage: number;
    uptime: number;
    timestamp: Date;
}

/**
 * Export format types
 */
export enum ExportFormat {
    PROMETHEUS = 'prometheus',
    STATSD = 'statsd',
    OPENTELEMETRY = 'opentelemetry',
    JSON = 'json'
}

/**
 * Exporter configuration
 */
export interface ExporterConfig {
    enabled: boolean;
    format: ExportFormat;
    endpoint?: string;
    interval?: number;
    prefix?: string;
    labels?: Record<string, string>;
    includeHistograms?: boolean;
    histogramBuckets?: number[];
    statsdHost?: string;
    statsdPort?: number;
    statsdPrefix?: string;
}

/**
 * Base metrics collector
 */
export class MetricsCollector extends EventEmitter {
    private metrics: Map<string, MetricDataPoint[]> = new Map();
    private providerMetrics: Map<string, ProviderMetrics> = new Map();
    private systemMetrics: SystemMetrics;
    private startTime: Date;
    private latencyHistogram: Map<string, number[]> = new Map();
    private readonly maxDataPoints = 10000;
    private readonly maxHistogramSize = 1000;

    constructor() {
        super();
        this.startTime = new Date();
        this.systemMetrics = this.createDefaultSystemMetrics();
    }

    /**
     * Record a metric
     */
    public record(metric: MetricDataPoint): void {
        const key = this.getMetricKey(metric);
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, []);
        }

        const dataPoints = this.metrics.get(key)!;
        dataPoints.push(metric);

        // Limit stored data points
        if (dataPoints.length > this.maxDataPoints) {
            dataPoints.shift();
        }

        // Update provider metrics if applicable
        if (metric.labels.provider) {
            this.updateProviderMetrics(metric);
        }

        // Update system metrics
        this.updateSystemMetrics(metric);

        // Emit metric event
        this.emit('metric', metric);
    }

    /**
     * Record latency
     */
    public recordLatency(provider: string, latency: number): void {
        this.record({
            name: 'llm_request_latency',
            type: MetricType.HISTOGRAM,
            value: latency,
            timestamp: new Date(),
            labels: { provider },
            unit: 'ms',
            description: 'LLM request latency'
        });

        // Update latency histogram
        if (!this.latencyHistogram.has(provider)) {
            this.latencyHistogram.set(provider, []);
        }
        
        const histogram = this.latencyHistogram.get(provider)!;
        histogram.push(latency);
        
        if (histogram.length > this.maxHistogramSize) {
            histogram.shift();
        }
    }

    /**
     * Record token usage
     */
    public recordTokenUsage(
        provider: string,
        inputTokens: number,
        outputTokens: number
    ): void {
        this.record({
            name: 'llm_tokens_used',
            type: MetricType.COUNTER,
            value: inputTokens + outputTokens,
            timestamp: new Date(),
            labels: { provider, type: 'total' },
            unit: 'tokens',
            description: 'Total tokens used'
        });

        this.record({
            name: 'llm_input_tokens',
            type: MetricType.COUNTER,
            value: inputTokens,
            timestamp: new Date(),
            labels: { provider },
            unit: 'tokens',
            description: 'Input tokens used'
        });

        this.record({
            name: 'llm_output_tokens',
            type: MetricType.COUNTER,
            value: outputTokens,
            timestamp: new Date(),
            labels: { provider },
            unit: 'tokens',
            description: 'Output tokens generated'
        });
    }

    /**
     * Record error
     */
    public recordError(provider: string, error: string): void {
        this.record({
            name: 'llm_errors',
            type: MetricType.COUNTER,
            value: 1,
            timestamp: new Date(),
            labels: { provider, error_type: this.classifyError(error) },
            description: 'LLM request errors'
        });

        // Update provider metrics
        const metrics = this.getProviderMetrics(provider);
        metrics.failures++;
        metrics.lastError = error;
        metrics.errorRate = metrics.failures / metrics.requests;
    }

    /**
     * Record request
     */
    public recordRequest(provider: string, success: boolean): void {
        this.record({
            name: 'llm_requests',
            type: MetricType.COUNTER,
            value: 1,
            timestamp: new Date(),
            labels: { provider, status: success ? 'success' : 'failure' },
            description: 'LLM requests'
        });

        const metrics = this.getProviderMetrics(provider);
        metrics.requests++;
        if (!success) {
            metrics.failures++;
        }
        metrics.successRate = (metrics.requests - metrics.failures) / metrics.requests;
    }

    /**
     * Get or create provider metrics
     */
    private getProviderMetrics(provider: string): ProviderMetrics {
        if (!this.providerMetrics.has(provider)) {
            this.providerMetrics.set(provider, {
                provider,
                requests: 0,
                failures: 0,
                successRate: 1,
                averageLatency: 0,
                p50Latency: 0,
                p95Latency: 0,
                p99Latency: 0,
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                averageTokensPerRequest: 0,
                errorRate: 0,
                lastUpdated: new Date()
            });
        }
        return this.providerMetrics.get(provider)!;
    }

    /**
     * Update provider metrics
     */
    private updateProviderMetrics(metric: MetricDataPoint): void {
        const provider = metric.labels.provider;
        if (!provider) return;

        const metrics = this.getProviderMetrics(provider);
        metrics.lastUpdated = new Date();

        // Update token metrics
        if (metric.name.includes('tokens')) {
            if (metric.name === 'llm_input_tokens') {
                metrics.inputTokens += metric.value;
            } else if (metric.name === 'llm_output_tokens') {
                metrics.outputTokens += metric.value;
            }
            metrics.totalTokens = metrics.inputTokens + metrics.outputTokens;
            if (metrics.requests > 0) {
                metrics.averageTokensPerRequest = metrics.totalTokens / metrics.requests;
            }
        }

        // Update latency metrics
        if (metric.name === 'llm_request_latency') {
            const histogram = this.latencyHistogram.get(provider);
            if (histogram && histogram.length > 0) {
                const sorted = [...histogram].sort((a, b) => a - b);
                metrics.averageLatency = sorted.reduce((a, b) => a + b, 0) / sorted.length;
                metrics.p50Latency = this.percentile(sorted, 50);
                metrics.p95Latency = this.percentile(sorted, 95);
                metrics.p99Latency = this.percentile(sorted, 99);
            }
        }
    }

    /**
     * Update system metrics
     */
    private updateSystemMetrics(metric: MetricDataPoint): void {
        if (metric.name === 'llm_requests') {
            this.systemMetrics.totalRequests++;
            if (metric.labels.status === 'failure') {
                this.systemMetrics.totalFailures++;
            }
        }

        this.systemMetrics.uptime = Date.now() - this.startTime.getTime();
        this.systemMetrics.timestamp = new Date();
        this.systemMetrics.memoryUsage = process.memoryUsage().heapUsed;
    }

    /**
     * Calculate percentile
     */
    private percentile(sorted: number[], p: number): number {
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Classify error type
     */
    private classifyError(error: string): string {
        const errorLower = error.toLowerCase();
        if (errorLower.includes('timeout')) return 'timeout';
        if (errorLower.includes('rate')) return 'rate_limit';
        if (errorLower.includes('auth')) return 'authentication';
        if (errorLower.includes('network')) return 'network';
        if (errorLower.includes('circuit')) return 'circuit_breaker';
        return 'unknown';
    }

    /**
     * Get metric key
     */
    private getMetricKey(metric: MetricDataPoint): string {
        const labelStr = Object.entries(metric.labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return `${metric.name}{${labelStr}}`;
    }

    /**
     * Create default system metrics
     */
    private createDefaultSystemMetrics(): SystemMetrics {
        return {
            totalRequests: 0,
            totalFailures: 0,
            averageLatency: 0,
            activePipelines: 0,
            cacheHitRate: 0,
            memoryUsage: 0,
            uptime: 0,
            timestamp: new Date()
        };
    }

    /**
     * Get all metrics
     */
    public getAllMetrics(): Map<string, MetricDataPoint[]> {
        return new Map(this.metrics);
    }

    /**
     * Get provider metrics
     */
    public getProviderMetricsMap(): Map<string, ProviderMetrics> {
        return new Map(this.providerMetrics);
    }

    /**
     * Get system metrics
     */
    public getSystemMetrics(): SystemMetrics {
        return { ...this.systemMetrics };
    }

    /**
     * Clear metrics
     */
    public clear(): void {
        this.metrics.clear();
        this.providerMetrics.clear();
        this.latencyHistogram.clear();
        this.systemMetrics = this.createDefaultSystemMetrics();
    }
}

/**
 * Prometheus format exporter
 */
export class PrometheusExporter {
    constructor(private collector: MetricsCollector) {}

    /**
     * Export metrics in Prometheus format
     */
    public export(): string {
        const lines: string[] = [];
        const metrics = this.collector.getAllMetrics();

        // Add help and type comments
        const metricTypes = new Map<string, MetricType>();
        const metricDescriptions = new Map<string, string>();

        for (const [key, dataPoints] of metrics) {
            if (dataPoints.length === 0) continue;
            
            const latest = dataPoints[dataPoints.length - 1];
            const metricName = latest.name;

            if (!metricTypes.has(metricName)) {
                metricTypes.set(metricName, latest.type);
                metricDescriptions.set(metricName, latest.description || '');
                
                lines.push(`# HELP ${metricName} ${latest.description || ''}`);
                lines.push(`# TYPE ${metricName} ${this.mapMetricType(latest.type)}`);
            }

            // Add metric value
            const labelStr = Object.entries(latest.labels)
                .map(([k, v]) => `${k}="${v}"`)
                .join(',');
            
            const metricLine = labelStr 
                ? `${metricName}{${labelStr}} ${latest.value}`
                : `${metricName} ${latest.value}`;
            
            lines.push(metricLine);
        }

        // Add provider-specific metrics
        for (const [provider, metrics] of this.collector.getProviderMetricsMap()) {
            lines.push(`# HELP llm_provider_success_rate Success rate by provider`);
            lines.push(`# TYPE llm_provider_success_rate gauge`);
            lines.push(`llm_provider_success_rate{provider="${provider}"} ${metrics.successRate}`);

            lines.push(`# HELP llm_provider_avg_latency Average latency by provider`);
            lines.push(`# TYPE llm_provider_avg_latency gauge`);
            lines.push(`llm_provider_avg_latency{provider="${provider}"} ${metrics.averageLatency}`);
        }

        // Add system metrics
        const systemMetrics = this.collector.getSystemMetrics();
        lines.push(`# HELP llm_system_uptime System uptime in milliseconds`);
        lines.push(`# TYPE llm_system_uptime counter`);
        lines.push(`llm_system_uptime ${systemMetrics.uptime}`);

        lines.push(`# HELP llm_system_memory_usage Memory usage in bytes`);
        lines.push(`# TYPE llm_system_memory_usage gauge`);
        lines.push(`llm_system_memory_usage ${systemMetrics.memoryUsage}`);

        return lines.join('\n');
    }

    /**
     * Map internal metric type to Prometheus type
     */
    private mapMetricType(type: MetricType): string {
        switch (type) {
            case MetricType.COUNTER:
                return 'counter';
            case MetricType.GAUGE:
                return 'gauge';
            case MetricType.HISTOGRAM:
                return 'histogram';
            case MetricType.SUMMARY:
                return 'summary';
            default:
                return 'gauge';
        }
    }
}

/**
 * StatsD format exporter
 */
export class StatsDExporter {
    constructor(
        private collector: MetricsCollector,
        private prefix: string = 'llm'
    ) {}

    /**
     * Export metrics in StatsD format
     */
    public export(): string[] {
        const lines: string[] = [];
        const metrics = this.collector.getAllMetrics();

        for (const [_, dataPoints] of metrics) {
            if (dataPoints.length === 0) continue;
            
            const latest = dataPoints[dataPoints.length - 1];
            const metricName = this.formatMetricName(latest.name, latest.labels);
            
            switch (latest.type) {
                case MetricType.COUNTER:
                    lines.push(`${metricName}:${latest.value}|c`);
                    break;
                case MetricType.GAUGE:
                    lines.push(`${metricName}:${latest.value}|g`);
                    break;
                case MetricType.HISTOGRAM:
                    lines.push(`${metricName}:${latest.value}|h`);
                    break;
                default:
                    lines.push(`${metricName}:${latest.value}|g`);
            }
        }

        return lines;
    }

    /**
     * Format metric name for StatsD
     */
    private formatMetricName(name: string, labels: Record<string, string>): string {
        const parts = [this.prefix, name];
        
        // Add important labels to the metric name
        if (labels.provider) {
            parts.push(labels.provider);
        }
        
        return parts.join('.');
    }
}

/**
 * OpenTelemetry format exporter
 */
export class OpenTelemetryExporter {
    constructor(private collector: MetricsCollector) {}

    /**
     * Export metrics in OpenTelemetry format
     */
    public export(): object {
        const metrics = this.collector.getAllMetrics();
        const providerMetrics = this.collector.getProviderMetricsMap();
        const systemMetrics = this.collector.getSystemMetrics();

        const resource = {
            attributes: {
                'service.name': 'trilium-llm',
                'service.version': '1.0.0'
            }
        };

        const scopeMetrics = {
            scope: {
                name: 'trilium.llm.metrics',
                version: '1.0.0'
            },
            metrics: [] as any[]
        };

        // Convert internal metrics to OTLP format
        for (const [key, dataPoints] of metrics) {
            if (dataPoints.length === 0) continue;

            const latest = dataPoints[dataPoints.length - 1];
            const metric = {
                name: latest.name,
                description: latest.description,
                unit: latest.unit,
                data: {
                    dataPoints: dataPoints.map(dp => ({
                        attributes: dp.labels,
                        timeUnixNano: dp.timestamp.getTime() * 1000000,
                        value: dp.value
                    }))
                }
            };

            scopeMetrics.metrics.push(metric);
        }

        return {
            resourceMetrics: [{
                resource,
                scopeMetrics: [scopeMetrics]
            }]
        };
    }
}

/**
 * Metrics Exporter Manager
 */
export class MetricsExporter {
    private static instance: MetricsExporter | null = null;
    private collector: MetricsCollector;
    private exporters: Map<ExportFormat, any> = new Map();
    private exportTimer?: NodeJS.Timeout;
    private config: ExporterConfig;

    constructor(config?: Partial<ExporterConfig>) {
        this.collector = new MetricsCollector();
        this.config = {
            enabled: config?.enabled ?? false,
            format: config?.format ?? ExportFormat.PROMETHEUS,
            interval: config?.interval ?? 60000, // 1 minute
            prefix: config?.prefix ?? 'llm',
            includeHistograms: config?.includeHistograms ?? true,
            histogramBuckets: config?.histogramBuckets ?? [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
            ...config
        };

        this.initializeExporters();

        if (this.config.enabled && this.config.interval) {
            this.startAutoExport();
        }
    }

    /**
     * Get singleton instance
     */
    public static getInstance(config?: Partial<ExporterConfig>): MetricsExporter {
        if (!MetricsExporter.instance) {
            MetricsExporter.instance = new MetricsExporter(config);
        }
        return MetricsExporter.instance;
    }

    /**
     * Initialize exporters
     */
    private initializeExporters(): void {
        this.exporters.set(
            ExportFormat.PROMETHEUS,
            new PrometheusExporter(this.collector)
        );
        
        this.exporters.set(
            ExportFormat.STATSD,
            new StatsDExporter(this.collector, this.config.prefix)
        );
        
        this.exporters.set(
            ExportFormat.OPENTELEMETRY,
            new OpenTelemetryExporter(this.collector)
        );
    }

    /**
     * Start auto export
     */
    private startAutoExport(): void {
        if (this.exportTimer) {
            clearInterval(this.exportTimer);
        }

        this.exportTimer = setInterval(() => {
            this.export();
        }, this.config.interval);
    }

    /**
     * Export metrics
     */
    public export(format?: ExportFormat): any {
        const exportFormat = format || this.config.format;
        const exporter = this.exporters.get(exportFormat);

        if (!exporter) {
            log.error(`[MetricsExporter] Unknown export format: ${exportFormat}`);
            return null;
        }

        try {
            const data = exporter.export();
            
            if (this.config.endpoint) {
                this.sendToEndpoint(data, exportFormat);
            }

            return data;
        } catch (error) {
            log.error(`[MetricsExporter] Export failed: ${error}`);
            return null;
        }
    }

    /**
     * Send metrics to endpoint
     */
    private async sendToEndpoint(data: any, format: ExportFormat): Promise<void> {
        if (!this.config.endpoint) return;

        try {
            const contentType = this.getContentType(format);
            const body = typeof data === 'string' ? data : JSON.stringify(data);

            // This would be replaced with actual HTTP client
            log.info(`[MetricsExporter] Would send metrics to ${this.config.endpoint}`);
            // await fetch(this.config.endpoint, {
            //     method: 'POST',
            //     headers: { 'Content-Type': contentType },
            //     body
            // });
        } catch (error) {
            log.error(`[MetricsExporter] Failed to send metrics: ${error}`);
        }
    }

    /**
     * Get content type for format
     */
    private getContentType(format: ExportFormat): string {
        switch (format) {
            case ExportFormat.PROMETHEUS:
                return 'text/plain; version=0.0.4';
            case ExportFormat.STATSD:
                return 'text/plain';
            case ExportFormat.OPENTELEMETRY:
                return 'application/json';
            default:
                return 'application/json';
        }
    }

    /**
     * Get metrics collector
     */
    public getCollector(): MetricsCollector {
        return this.collector;
    }

    /**
     * Enable/disable exporter
     */
    public setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
        
        if (enabled && this.config.interval && !this.exportTimer) {
            this.startAutoExport();
        } else if (!enabled && this.exportTimer) {
            clearInterval(this.exportTimer);
            this.exportTimer = undefined;
        }
    }

    /**
     * Update configuration
     */
    public updateConfig(config: Partial<ExporterConfig>): void {
        this.config = { ...this.config, ...config };
        
        if (this.config.enabled && this.config.interval) {
            this.startAutoExport();
        }
    }

    /**
     * Dispose exporter
     */
    public dispose(): void {
        if (this.exportTimer) {
            clearInterval(this.exportTimer);
            this.exportTimer = undefined;
        }
        
        this.collector.clear();
        MetricsExporter.instance = null;
    }
}

// Export singleton getter
export const getMetricsExporter = (config?: Partial<ExporterConfig>): MetricsExporter => {
    return MetricsExporter.getInstance(config);
};