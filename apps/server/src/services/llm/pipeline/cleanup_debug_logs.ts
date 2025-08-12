#!/usr/bin/env node

/**
 * Script to clean up debug log statements from production code
 * 
 * This script:
 * 1. Finds all log.info("[DEBUG]") statements
 * 2. Converts them to proper debug level logging
 * 3. Reports on other verbose logging that should be reviewed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Patterns to find and replace
const patterns = [
    {
        name: 'Debug in info logs',
        find: /log\.info\((.*?)\[DEBUG\](.*?)\)/g,
        replace: 'log.debug($1$2)',
        count: 0
    },
    {
        name: 'Tool call debug',
        find: /log\.info\((.*?)\[TOOL CALL DEBUG\](.*?)\)/g,
        replace: 'log.debug($1Tool call: $2)',
        count: 0
    },
    {
        name: 'Excessive separators',
        find: /log\.info\(['"`]={10,}.*?={10,}['"`]\)/g,
        replace: null, // Just count, don't replace
        count: 0
    },
    {
        name: 'Pipeline stage logs',
        find: /log\.info\(['"`].*?STAGE \d+:.*?['"`]\)/g,
        replace: null, // Just count, don't replace
        count: 0
    }
];

// Files to process
const filesToProcess = [
    path.join(__dirname, '..', 'pipeline', 'chat_pipeline.ts'),
    path.join(__dirname, '..', 'providers', 'anthropic_service.ts'),
    path.join(__dirname, '..', 'providers', 'openai_service.ts'),
    path.join(__dirname, '..', 'providers', 'ollama_service.ts'),
    path.join(__dirname, '..', 'tools', 'tool_registry.ts'),
];

// Additional directories to scan
const directoriesToScan = [
    path.join(__dirname, '..', 'pipeline', 'stages'),
    path.join(__dirname, '..', 'tools'),
];

/**
 * Process a single file
 */
function processFile(filePath: string, dryRun: boolean = true): void {
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${filePath}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    
    console.log(`\nProcessing: ${path.basename(filePath)}`);
    
    patterns.forEach(pattern => {
        const matches = content.match(pattern.find) || [];
        if (matches.length > 0) {
            console.log(`  Found ${matches.length} instances of "${pattern.name}"`);
            pattern.count += matches.length;
            
            if (pattern.replace && !dryRun) {
                content = content.replace(pattern.find, pattern.replace);
                modified = true;
            }
        }
    });
    
    if (modified && !dryRun) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`  ✓ File updated`);
    }
}

/**
 * Scan directory for files
 */
function scanDirectory(dirPath: string): string[] {
    const files: string[] = [];
    
    if (!fs.existsSync(dirPath)) {
        return files;
    }
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
            files.push(...scanDirectory(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    
    return files;
}

/**
 * Main function
 */
function main(): void {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--apply');
    
    console.log('========================================');
    console.log('Debug Log Cleanup Script');
    console.log('========================================');
    console.log(dryRun ? 'Mode: DRY RUN (use --apply to make changes)' : 'Mode: APPLYING CHANGES');
    
    // Collect all files to process
    const allFiles = [...filesToProcess];
    
    directoriesToScan.forEach(dir => {
        allFiles.push(...scanDirectory(dir));
    });
    
    // Remove duplicates
    const uniqueFiles = [...new Set(allFiles)];
    
    console.log(`\nFound ${uniqueFiles.length} TypeScript files to process`);
    
    // Process each file
    uniqueFiles.forEach(file => processFile(file, dryRun));
    
    // Summary
    console.log('\n========================================');
    console.log('Summary');
    console.log('========================================');
    
    patterns.forEach(pattern => {
        if (pattern.count > 0) {
            console.log(`${pattern.name}: ${pattern.count} instances`);
        }
    });
    
    const totalIssues = patterns.reduce((sum, p) => sum + p.count, 0);
    
    if (totalIssues === 0) {
        console.log('✓ No debug statements found!');
    } else if (dryRun) {
        console.log(`\nFound ${totalIssues} total issues.`);
        console.log('Run with --apply to fix replaceable patterns.');
    } else {
        const fixedCount = patterns.filter(p => p.replace).reduce((sum, p) => sum + p.count, 0);
        console.log(`\n✓ Fixed ${fixedCount} issues.`);
        
        const remainingCount = patterns.filter(p => !p.replace).reduce((sum, p) => sum + p.count, 0);
        if (remainingCount > 0) {
            console.log(`ℹ ${remainingCount} instances need manual review.`);
        }
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { processFile, scanDirectory };