import type { NextFunction,Request, Response, Router } from "express";

import appInfo from "../services/app_info.js";
import sql from "../services/sql.js";
import eu from "./etapi_utils.js";

interface MetricsData {
    version: {
        app: string;
        db: number;
        node?: string;
        sync: number;
        buildDate: string;
        buildRevision: string;
    };
    database: {
        totalNotes: number;
        deletedNotes: number;
        activeNotes: number;
        protectedNotes: number;
        totalAttachments: number;
        deletedAttachments: number;
        activeAttachments: number;
        totalRevisions: number;
        totalBranches: number;
        totalAttributes: number;
        totalBlobs: number;
        totalEtapiTokens: number;
        totalRecentNotes: number;
    };
    noteTypes: Record<string, number>;
    attachmentTypes: Record<string, number>;
    statistics: {
        oldestNote: string | null;
        newestNote: string | null;
        lastModified: string | null;
        databaseSizeBytes: number | null;
    };
    timestamp: string;
}

/**
 * Converts metrics data to Prometheus text format
 */
function formatPrometheusMetrics(data: MetricsData): string {
    const lines: string[] = [];

    // Helper function to add a metric
    const addMetric = (name: string, value: number | null, help: string, type: string = 'gauge', labels: Record<string, string | undefined> = {}) => {
        if (value === null) return;

        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);

        const labelStr = Object.entries(labels).length > 0
            ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
            : '';

        lines.push(`${name}${labelStr} ${value}`);
        lines.push('');
    };

    // Version info
    addMetric('trilium_info', 1, 'Trilium instance information', 'gauge', {
        version: data.version.app,
        db_version: data.version.db.toString(),
        node_version: data.version.node,
        sync_version: data.version.sync.toString(),
        build_date: data.version.buildDate,
        build_revision: data.version.buildRevision
    });

    // Database metrics
    addMetric('trilium_notes_total', data.database.totalNotes, 'Total number of notes including deleted');
    addMetric('trilium_notes_deleted', data.database.deletedNotes, 'Number of deleted notes');
    addMetric('trilium_notes_active', data.database.activeNotes, 'Number of active notes');
    addMetric('trilium_notes_protected', data.database.protectedNotes, 'Number of protected notes');

    addMetric('trilium_attachments_total', data.database.totalAttachments, 'Total number of attachments including deleted');
    addMetric('trilium_attachments_deleted', data.database.deletedAttachments, 'Number of deleted attachments');
    addMetric('trilium_attachments_active', data.database.activeAttachments, 'Number of active attachments');

    addMetric('trilium_revisions_total', data.database.totalRevisions, 'Total number of note revisions');
    addMetric('trilium_branches_total', data.database.totalBranches, 'Number of active branches');
    addMetric('trilium_attributes_total', data.database.totalAttributes, 'Number of active attributes');
    addMetric('trilium_blobs_total', data.database.totalBlobs, 'Total number of blob records');
    addMetric('trilium_etapi_tokens_total', data.database.totalEtapiTokens, 'Number of active ETAPI tokens');
    addMetric('trilium_recent_notes_total', data.database.totalRecentNotes, 'Number of recent notes tracked');

    // Note types
    for (const [type, count] of Object.entries(data.noteTypes)) {
        addMetric('trilium_notes_by_type', count, 'Number of notes by type', 'gauge', { type });
    }

    // Attachment types
    for (const [mime, count] of Object.entries(data.attachmentTypes)) {
        addMetric('trilium_attachments_by_type', count, 'Number of attachments by MIME type', 'gauge', { mime_type: mime });
    }

    // Statistics
    if (data.statistics.databaseSizeBytes !== null) {
        addMetric('trilium_database_size_bytes', data.statistics.databaseSizeBytes, 'Database size in bytes');
    }

    if (data.statistics.oldestNote) {
        const oldestTimestamp = Math.floor(new Date(data.statistics.oldestNote).getTime() / 1000);
        addMetric('trilium_oldest_note_timestamp', oldestTimestamp, 'Timestamp of the oldest note');
    }

    if (data.statistics.newestNote) {
        const newestTimestamp = Math.floor(new Date(data.statistics.newestNote).getTime() / 1000);
        addMetric('trilium_newest_note_timestamp', newestTimestamp, 'Timestamp of the newest note');
    }

    if (data.statistics.lastModified) {
        const lastModifiedTimestamp = Math.floor(new Date(data.statistics.lastModified).getTime() / 1000);
        addMetric('trilium_last_modified_timestamp', lastModifiedTimestamp, 'Timestamp of the last modification');
    }

    return lines.join('\n');
}

/**
 * Collects comprehensive metrics about the Trilium instance
 */
function collectMetrics(): MetricsData {
    // Version information
    const version = {
        app: appInfo.appVersion,
        db: appInfo.dbVersion,
        node: appInfo.nodeVersion,
        sync: appInfo.syncVersion,
        buildDate: appInfo.buildDate,
        buildRevision: appInfo.buildRevision
    };

    // Database counts
    const totalNotes = sql.getValue<number>("SELECT COUNT(*) FROM notes");
    const deletedNotes = sql.getValue<number>("SELECT COUNT(*) FROM notes WHERE isDeleted = 1");
    const activeNotes = totalNotes - deletedNotes;
    const protectedNotes = sql.getValue<number>("SELECT COUNT(*) FROM notes WHERE isProtected = 1 AND isDeleted = 0");

    const totalAttachments = sql.getValue<number>("SELECT COUNT(*) FROM attachments");
    const deletedAttachments = sql.getValue<number>("SELECT COUNT(*) FROM attachments WHERE isDeleted = 1");
    const activeAttachments = totalAttachments - deletedAttachments;

    const totalRevisions = sql.getValue<number>("SELECT COUNT(*) FROM revisions");
    const totalBranches = sql.getValue<number>("SELECT COUNT(*) FROM branches WHERE isDeleted = 0");
    const totalAttributes = sql.getValue<number>("SELECT COUNT(*) FROM attributes WHERE isDeleted = 0");
    const totalBlobs = sql.getValue<number>("SELECT COUNT(*) FROM blobs");
    const totalEtapiTokens = sql.getValue<number>("SELECT COUNT(*) FROM etapi_tokens WHERE isDeleted = 0");
    const totalRecentNotes = sql.getValue<number>("SELECT COUNT(*) FROM recent_notes");


    const database = {
        totalNotes,
        deletedNotes,
        activeNotes,
        protectedNotes,
        totalAttachments,
        deletedAttachments,
        activeAttachments,
        totalRevisions,
        totalBranches,
        totalAttributes,
        totalBlobs,
        totalEtapiTokens,
        totalRecentNotes,
    };

    // Note types breakdown
    const noteTypesRows = sql.getRows<{ type: string; count: number }>(
        "SELECT type, COUNT(*) as count FROM notes WHERE isDeleted = 0 GROUP BY type ORDER BY count DESC"
    );
    const noteTypes: Record<string, number> = {};
    for (const row of noteTypesRows) {
        noteTypes[row.type] = row.count;
    }

    // Attachment types breakdown
    const attachmentTypesRows = sql.getRows<{ mime: string; count: number }>(
        "SELECT mime, COUNT(*) as count FROM attachments WHERE isDeleted = 0 GROUP BY mime ORDER BY count DESC"
    );
    const attachmentTypes: Record<string, number> = {};
    for (const row of attachmentTypesRows) {
        attachmentTypes[row.mime] = row.count;
    }

    // Statistics
    const oldestNote = sql.getValue<string | null>(
        "SELECT utcDateCreated FROM notes WHERE isDeleted = 0 ORDER BY utcDateCreated ASC LIMIT 1"
    );
    const newestNote = sql.getValue<string | null>(
        "SELECT utcDateCreated FROM notes WHERE isDeleted = 0 ORDER BY utcDateCreated DESC LIMIT 1"
    );
    const lastModified = sql.getValue<string | null>(
        "SELECT utcDateModified FROM notes WHERE isDeleted = 0 ORDER BY utcDateModified DESC LIMIT 1"
    );

    // Database size (this might not work on all systems)
    let databaseSizeBytes: number | null = null;
    try {
        const sizeResult = sql.getValue<number>("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
        databaseSizeBytes = sizeResult;
    } catch (e) {
        // Pragma might not be available
    }

    const statistics = {
        oldestNote,
        newestNote,
        lastModified,
        databaseSizeBytes
    };

    return {
        version,
        database,
        noteTypes,
        attachmentTypes,
        statistics,
        timestamp: new Date().toISOString()
    };
}

function register(router: Router): void {
    eu.route(router, "get", "/etapi/metrics", (req: Request, res: Response, next: NextFunction) => {
        try {
            const metrics = collectMetrics();
            const format = (req.query.format as string)?.toLowerCase() || 'prometheus';

            if (format === 'json') {
                res.status(200).json(metrics);
            } else if (format === 'prometheus') {
                const prometheusText = formatPrometheusMetrics(metrics);
                res.status(200)
                    .set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
                    .send(prometheusText);
            } else {
                throw new eu.EtapiError(400, "INVALID_FORMAT", "Supported formats: 'prometheus' (default), 'json'");
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new eu.EtapiError(500, "METRICS_ERROR", `Failed to collect metrics: ${errorMessage}`);
        }
    });
}

export default {
    register,
    collectMetrics,
    formatPrometheusMetrics
};
