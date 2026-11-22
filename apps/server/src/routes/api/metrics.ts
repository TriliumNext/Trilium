import { ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";

import etapiMetrics from "../../etapi/metrics.js";

type MetricsData = ReturnType<typeof etapiMetrics.collectMetrics>;

function getMetrics(req: Request, res: Response): string | MetricsData {
    const format = (req.query?.format as string)?.toLowerCase() || 'prometheus';

    if (format === 'json') {
        return etapiMetrics.collectMetrics();
    } else if (format === 'prometheus') {
        const metrics = etapiMetrics.collectMetrics();
        const prometheusText = etapiMetrics.formatPrometheusMetrics(metrics);
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return prometheusText;
    } else {
        throw new ValidationError("Supported formats: 'prometheus' (default), 'json'");
    }
}

export default {
    getMetrics
};
