/**
 * API routes for enhanced LLM tool functionality
 */

import express from 'express';
import log from '../../services/log.js';
import { toolPreviewManager } from '../../services/llm/tools/tool_preview.js';
import { toolFeedbackManager } from '../../services/llm/tools/tool_feedback.js';
import { toolErrorRecoveryManager, ToolErrorType } from '../../services/llm/tools/tool_error_recovery.js';
import toolRegistry from '../../services/llm/tools/tool_registry.js';

const router = express.Router();

/**
 * Get tool preview for pending executions
 */
router.post('/preview', async (req, res) => {
    try {
        const { toolCalls } = req.body;

        if (!toolCalls || !Array.isArray(toolCalls)) {
            return res.status(400).json({ 
                error: 'Invalid request: toolCalls array required' 
            });
        }

        // Get tool handlers
        const handlers = new Map();
        for (const toolCall of toolCalls) {
            const tool = toolRegistry.getTool(toolCall.function.name);
            if (tool) {
                handlers.set(toolCall.function.name, tool);
            }
        }

        // Create execution plan
        const plan = toolPreviewManager.createExecutionPlan(toolCalls, handlers);

        res.json(plan);
    } catch (error: any) {
        log.error(`Error creating tool preview: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to create tool preview',
            message: error.message 
        });
    }
});

/**
 * Submit tool approval/rejection
 */
router.post('/preview/:planId/approval', async (req, res) => {
    try {
        const { planId } = req.params;
        const approval = req.body;

        if (!approval || typeof approval.approved === 'undefined') {
            return res.status(400).json({ 
                error: 'Invalid approval data' 
            });
        }

        approval.planId = planId;
        toolPreviewManager.recordApproval(approval);

        res.json({ 
            success: true,
            message: approval.approved ? 'Execution approved' : 'Execution rejected'
        });
    } catch (error: any) {
        log.error(`Error recording approval: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to record approval',
            message: error.message 
        });
    }
});

/**
 * Get active tool executions
 */
router.get('/executions/active', async (req, res) => {
    try {
        const executions = toolFeedbackManager.getActiveExecutions();
        res.json(executions);
    } catch (error: any) {
        log.error(`Error getting active executions: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to get active executions',
            message: error.message 
        });
    }
});

/**
 * Get tool execution history
 */
router.get('/executions/history', async (req, res) => {
    try {
        const { toolName, status, limit } = req.query;

        const filter: any = {};
        if (toolName) filter.toolName = String(toolName);
        if (status) filter.status = String(status);
        if (limit) filter.limit = parseInt(String(limit), 10);

        const history = toolFeedbackManager.getHistory(filter);
        res.json(history);
    } catch (error: any) {
        log.error(`Error getting execution history: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to get execution history',
            message: error.message 
        });
    }
});

/**
 * Get tool execution statistics
 */
router.get('/executions/stats', async (req, res) => {
    try {
        const stats = toolFeedbackManager.getStatistics();
        res.json(stats);
    } catch (error: any) {
        log.error(`Error getting execution statistics: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to get execution statistics',
            message: error.message 
        });
    }
});

/**
 * Cancel a running tool execution
 */
router.post('/executions/:executionId/cancel', async (req, res) => {
    try {
        const { executionId } = req.params;
        const { reason } = req.body;

        const success = toolFeedbackManager.cancelExecution(
            executionId,
            'api',
            reason
        );

        if (success) {
            res.json({ 
                success: true,
                message: 'Execution cancelled'
            });
        } else {
            res.status(404).json({ 
                error: 'Execution not found or not cancellable' 
            });
        }
    } catch (error: any) {
        log.error(`Error cancelling execution: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to cancel execution',
            message: error.message 
        });
    }
});

/**
 * Get circuit breaker status for tools
 */
router.get('/circuit-breakers', async (req, res) => {
    try {
        const tools = toolRegistry.getAllTools();
        const statuses: any[] = [];

        for (const tool of tools) {
            const toolName = tool.definition.function.name;
            const state = toolErrorRecoveryManager.getCircuitBreakerState(toolName);
            
            statuses.push({
                toolName,
                displayName: tool.definition.function.name,
                state: state || 'closed',
                errorHistory: toolErrorRecoveryManager.getErrorHistory(toolName).length
            });
        }

        res.json(statuses);
    } catch (error: any) {
        log.error(`Error getting circuit breaker status: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to get circuit breaker status',
            message: error.message 
        });
    }
});

/**
 * Reset circuit breaker for a tool
 */
router.post('/circuit-breakers/:toolName/reset', async (req, res) => {
    try {
        const { toolName } = req.params;

        toolErrorRecoveryManager.resetCircuitBreaker(toolName);

        res.json({ 
            success: true,
            message: `Circuit breaker reset for ${toolName}`
        });
    } catch (error: any) {
        log.error(`Error resetting circuit breaker: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to reset circuit breaker',
            message: error.message 
        });
    }
});

/**
 * Get error recovery suggestions
 */
router.post('/errors/suggest-recovery', async (req, res) => {
    try {
        const { toolName, error, parameters } = req.body;

        if (!toolName || !error) {
            return res.status(400).json({ 
                error: 'toolName and error are required' 
            });
        }

        // Categorize the error
        const categorizedError = toolErrorRecoveryManager.categorizeError(error);

        // Get recovery suggestions
        const suggestions = toolErrorRecoveryManager.suggestRecoveryActions(
            toolName,
            categorizedError,
            parameters || {}
        );

        res.json({
            error: categorizedError,
            suggestions
        });
    } catch (error: any) {
        log.error(`Error getting recovery suggestions: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to get recovery suggestions',
            message: error.message 
        });
    }
});

/**
 * Test tool execution with mock data
 */
router.post('/test/:toolName', async (req, res) => {
    try {
        const { toolName } = req.params;
        const { parameters } = req.body;

        const tool = toolRegistry.getTool(toolName);
        if (!tool) {
            return res.status(404).json({ 
                error: `Tool not found: ${toolName}` 
            });
        }

        // Create a mock tool call
        const toolCall = {
            id: `test-${Date.now()}`,
            function: {
                name: toolName,
                arguments: parameters || {}
            }
        };

        // Execute with recovery
        const result = await toolErrorRecoveryManager.executeWithRecovery(
            toolCall,
            tool,
            (attempt, delay) => {
                log.info(`Test execution retry: attempt ${attempt}, delay ${delay}ms`);
            }
        );

        res.json(result);
    } catch (error: any) {
        log.error(`Error testing tool: ${error.message}`);
        res.status(500).json({ 
            error: 'Failed to test tool',
            message: error.message 
        });
    }
});

export default router;