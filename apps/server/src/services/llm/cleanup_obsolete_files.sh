#!/bin/bash

# Cleanup script for obsolete LLM files after Phase 1 and Phase 2 refactoring
# This script removes files that have been replaced by the simplified architecture

echo "======================================"
echo "LLM Cleanup Script - Phase 1 & 2"
echo "======================================"
echo ""
echo "This script will remove obsolete files replaced by:"
echo "- Simplified 4-stage pipeline"
echo "- Centralized configuration service"
echo "- New tool format adapter"
echo ""

# Safety check
read -p "Are you sure you want to remove obsolete LLM files? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cleanup cancelled."
    exit 0
fi

# Counter for removed files
removed_count=0

# Function to safely remove a file
remove_file() {
    local file=$1
    if [ -f "$file" ]; then
        echo "Removing: $file"
        rm "$file"
        ((removed_count++))
    else
        echo "Already removed or doesn't exist: $file"
    fi
}

echo ""
echo "Starting cleanup..."
echo ""

# ============================================
# PIPELINE STAGES - Replaced by simplified_pipeline.ts
# ============================================
echo "Removing old pipeline stages (replaced by 4-stage simplified pipeline)..."

# Old 9-stage pipeline implementation
remove_file "pipeline/stages/agent_tools_context_stage.ts"
remove_file "pipeline/stages/context_extraction_stage.ts"
remove_file "pipeline/stages/error_recovery_stage.ts"
remove_file "pipeline/stages/llm_completion_stage.ts"
remove_file "pipeline/stages/message_preparation_stage.ts"
remove_file "pipeline/stages/model_selection_stage.ts"
remove_file "pipeline/stages/response_processing_stage.ts"
remove_file "pipeline/stages/semantic_context_extraction_stage.ts"
remove_file "pipeline/stages/tool_calling_stage.ts"
remove_file "pipeline/stages/user_interaction_stage.ts"

# Old pipeline base class
remove_file "pipeline/pipeline_stage.ts"

# Old complex pipeline (replaced by simplified_pipeline.ts)
remove_file "pipeline/chat_pipeline.ts"
remove_file "pipeline/chat_pipeline.spec.ts"

echo ""

# ============================================
# CONFIGURATION - Replaced by configuration_service.ts
# ============================================
echo "Removing old configuration files (replaced by centralized configuration_service.ts)..."

# Old configuration helpers are still used, but configuration_manager can be removed if it exists
remove_file "config/configuration_manager.ts"

echo ""

# ============================================
# FORMATTERS - Consolidated into tool_format_adapter.ts
# ============================================
echo "Removing old formatter files (replaced by tool_format_adapter.ts)..."

# Old individual formatters if they exist
remove_file "formatters/base_formatter.ts"
remove_file "formatters/openai_formatter.ts"
remove_file "formatters/anthropic_formatter.ts"
remove_file "formatters/ollama_formatter.ts"

echo ""

# ============================================
# DUPLICATE SERVICES - Consolidated
# ============================================
echo "Removing duplicate service files..."

# ChatService is replaced by RestChatService with simplified pipeline
remove_file "chat_service.ts"
remove_file "chat_service.spec.ts"

echo ""

# ============================================
# OLD INTERFACES - Check which are still needed
# ============================================
echo "Checking interfaces..."

# Note: Some interfaces may still be needed, so we'll be careful here
# The pipeline/interfaces.ts is still used by pipeline_adapter.ts

echo ""

# ============================================
# UNUSED CONTEXT EXTRACTORS
# ============================================
echo "Checking context extractors..."

# These might still be used, so let's check first
echo "Note: Context extractors in context_extractors/ may still be in use"
echo "Skipping context_extractors for safety"

echo ""

# ============================================
# REMOVE EMPTY DIRECTORIES
# ============================================
echo "Removing empty directories..."

# Remove stages directory if empty
if [ -d "pipeline/stages" ]; then
    if [ -z "$(ls -A pipeline/stages)" ]; then
        echo "Removing empty directory: pipeline/stages"
        rmdir "pipeline/stages"
        ((removed_count++))
    fi
fi

# Remove formatters directory if empty
if [ -d "formatters" ]; then
    if [ -z "$(ls -A formatters)" ]; then
        echo "Removing empty directory: formatters"
        rmdir "formatters"
        ((removed_count++))
    fi
fi

echo ""
echo "======================================"
echo "Cleanup Complete!"
echo "======================================"
echo "Removed $removed_count files/directories"
echo ""
echo "Remaining structure:"
echo "- simplified_pipeline.ts (new 4-stage pipeline)"
echo "- pipeline_adapter.ts (backward compatibility)"
echo "- configuration_service.ts (centralized config)"
echo "- model_registry.ts (model capabilities)"
echo "- logging_service.ts (structured logging)"
echo "- tool_format_adapter.ts (unified tool conversion)"
echo ""
echo "Note: The pipeline_adapter.ts provides backward compatibility"
echo "until all references to the old pipeline are updated."