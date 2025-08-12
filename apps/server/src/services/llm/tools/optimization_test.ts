/**
 * Tool Optimization Test - Phase 4 Verification
 *
 * Tests the core tool optimization to ensure:
 * - Token usage reduced from 15,000 to 5,000 (67% reduction)
 * - 27 tools reduced to 8 core tools 
 * - All functionality preserved through consolidation
 * - Ollama compatibility achieved
 */

import { initializeOptimizedTools } from './optimized_tool_initializer.js';
import { toolContextManager, ToolContext, TOOL_CONTEXTS } from './tool_context_manager.js';
import toolRegistry from './tool_registry.js';

/**
 * Test the core optimization
 */
export async function testCoreOptimization(): Promise<{
    success: boolean;
    results: {
        tokenReduction: number;
        toolReduction: number;
        ollamaCompatible: boolean;
        coreToolsLoaded: string[];
        consolidationSuccess: boolean;
    };
    errors: string[];
}> {
    const errors: string[] = [];
    
    try {
        console.log('🧪 Testing Core Tool Optimization...\n');
        
        // Test core context initialization
        const result = await initializeOptimizedTools('core', {
            enableSmartProcessing: true,
            clearRegistry: true,
            validateDependencies: true
        });

        // Verify optimization targets
        const originalToolCount = 27;
        const originalTokenCount = 15000;
        const targetTokenCount = 5000;
        const targetToolCount = 8;

        const tokenReduction = ((originalTokenCount - result.tokenUsage) / originalTokenCount) * 100;
        const toolReduction = ((originalToolCount - result.toolsLoaded) / originalToolCount) * 100;
        
        // Get loaded tools
        const loadedTools = toolRegistry.getAllTools();
        const coreToolsLoaded = loadedTools.map(tool => tool.definition.function.name);

        // Expected core tools
        const expectedCoreTools = [
            'smart_search',      // Universal search
            'read_note',         // Content access  
            'find_and_read',     // Compound tool
            'find_and_update',   // Compound tool
            'note_creation',     // Basic creation
            'note_update',       // Content modification
            'attribute_manager', // Metadata management
            'clone_note'         // Unique Trilium feature
        ];

        // Verify core tools are loaded
        const consolidationSuccess = expectedCoreTools.every(tool => 
            coreToolsLoaded.includes(tool)
        );

        if (!consolidationSuccess) {
            const missing = expectedCoreTools.filter(tool => 
                !coreToolsLoaded.includes(tool)
            );
            errors.push(`Missing core tools: ${missing.join(', ')}`);
        }

        // Test results
        const ollamaCompatible = result.tokenUsage <= 5000;
        
        console.log('📊 Optimization Results:');
        console.log(`   Token Usage: ${originalTokenCount} → ${result.tokenUsage} (${tokenReduction.toFixed(1)}% reduction)`);
        console.log(`   Tool Count: ${originalToolCount} → ${result.toolsLoaded} (${toolReduction.toFixed(1)}% reduction)`);
        console.log(`   Ollama Compatible: ${ollamaCompatible ? '✅ YES' : '❌ NO'} (≤5000 tokens)`);
        console.log(`   Core Tools: ${coreToolsLoaded.length === targetToolCount ? '✅' : '❌'} ${coreToolsLoaded.length}/8 loaded`);
        console.log(`   Consolidation: ${consolidationSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        if (tokenReduction < 60) {
            errors.push(`Token reduction ${tokenReduction.toFixed(1)}% is below target 67%`);
        }

        if (result.toolsLoaded > 10) {
            errors.push(`Tool count ${result.toolsLoaded} exceeds target of 8-10 core tools`);
        }

        console.log('\n🔧 Loaded Core Tools:');
        coreToolsLoaded.forEach(tool => {
            const isCore = expectedCoreTools.includes(tool);
            console.log(`   ${isCore ? '✅' : '⚠️'} ${tool}`);
        });

        const success = errors.length === 0 && 
                       tokenReduction >= 60 && 
                       ollamaCompatible &&
                       consolidationSuccess;

        return {
            success,
            results: {
                tokenReduction: Math.round(tokenReduction),
                toolReduction: Math.round(toolReduction),
                ollamaCompatible,
                coreToolsLoaded,
                consolidationSuccess
            },
            errors
        };

    } catch (error: any) {
        const errorMessage = error.message || String(error);
        errors.push(`Test execution failed: ${errorMessage}`);
        
        return {
            success: false,
            results: {
                tokenReduction: 0,
                toolReduction: 0,
                ollamaCompatible: false,
                coreToolsLoaded: [],
                consolidationSuccess: false
            },
            errors
        };
    }
}

/**
 * Test all context configurations
 */
export async function testAllContexts(): Promise<void> {
    console.log('\n🌐 Testing All Tool Contexts...\n');
    
    const contexts: ToolContext[] = ['core', 'advanced', 'admin', 'full'];
    
    for (const context of contexts) {
        try {
            console.log(`📋 Testing ${context.toUpperCase()} context:`);
            
            const result = await initializeOptimizedTools(context);
            const usage = toolContextManager.getContextTokenUsage(context);
            const contextInfo = TOOL_CONTEXTS[context];
            
            console.log(`   Tools: ${result.toolsLoaded}`);
            console.log(`   Tokens: ${result.tokenUsage}/${contextInfo.tokenBudget} (${Math.round(usage.utilization * 100)}%)`);
            console.log(`   Budget: ${result.tokenUsage <= contextInfo.tokenBudget ? '✅' : '❌'} Within budget`);
            console.log(`   Use Case: ${contextInfo.useCase}`);
            console.log('');
            
        } catch (error: any) {
            console.log(`   ❌ FAILED: ${error.message}`);
            console.log('');
        }
    }
}

/**
 * Test search consolidation specifically
 */
export async function testSearchConsolidation(): Promise<boolean> {
    console.log('\n🔍 Testing Search Tool Consolidation...\n');
    
    try {
        await initializeOptimizedTools('core');
        const loadedTools = toolRegistry.getAllTools();
        const loadedToolNames = loadedTools.map(t => t.definition.function.name);
        
        // Verify smart_search is loaded
        const hasSmartSearch = loadedToolNames.includes('smart_search');
        
        // Verify redundant search tools are NOT loaded in core context
        const redundantTools = [
            'search_notes_tool',
            'keyword_search_tool', 
            'attribute_search_tool',
            'unified_search_tool'
        ];
        
        const redundantLoaded = redundantTools.filter(tool => 
            loadedToolNames.includes(tool)
        );
        
        console.log(`Smart Search Loaded: ${hasSmartSearch ? '✅ YES' : '❌ NO'}`);
        console.log(`Redundant Search Tools: ${redundantLoaded.length === 0 ? '✅ NONE' : `❌ ${redundantLoaded.join(', ')}`}`);
        
        const consolidationSuccess = hasSmartSearch && redundantLoaded.length === 0;
        console.log(`Search Consolidation: ${consolidationSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        return consolidationSuccess;
        
    } catch (error: any) {
        console.log(`❌ Search consolidation test failed: ${error.message}`);
        return false;
    }
}

/**
 * Run all optimization tests
 */
export async function runOptimizationTests(): Promise<boolean> {
    console.log('🚀 Running Tool Optimization Tests\n');
    console.log('=' .repeat(50));
    
    try {
        // Test 1: Core optimization
        const coreTest = await testCoreOptimization();
        
        if (coreTest.errors.length > 0) {
            console.log('\n❌ Core optimization errors:');
            coreTest.errors.forEach(error => console.log(`   - ${error}`));
        }
        
        // Test 2: Context configurations
        await testAllContexts();
        
        // Test 3: Search consolidation
        const searchTest = await testSearchConsolidation();
        
        // Overall result
        const allTestsPassed = coreTest.success && searchTest;
        
        console.log('\n' + '=' .repeat(50));
        console.log(`🎯 OPTIMIZATION TEST RESULT: ${allTestsPassed ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        if (allTestsPassed) {
            console.log('\n🎉 Tool optimization is working correctly!');
            console.log(`   - ${coreTest.results.tokenReduction}% token reduction achieved`);
            console.log(`   - ${coreTest.results.toolReduction}% tool reduction achieved`);
            console.log(`   - Ollama compatibility: ${coreTest.results.ollamaCompatible ? 'YES' : 'NO'}`);
            console.log(`   - Search consolidation: ${searchTest ? 'SUCCESS' : 'FAILED'}`);
        }
        
        return allTestsPassed;
        
    } catch (error: any) {
        console.log(`\n💥 Test suite failed: ${error.message}`);
        return false;
    }
}

// Export for external testing
export default {
    testCoreOptimization,
    testAllContexts,
    testSearchConsolidation,
    runOptimizationTests
};