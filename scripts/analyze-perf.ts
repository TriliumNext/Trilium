import * as path from 'path';
import * as http from "http";
import { spawn } from 'child_process';

interface PerfEntry {
    operation: string;
    time: number;
    file: string;
    fullLine: string;
}

interface AggregatedStats {
    totalTime: number;
    count: number;
    files: string[];
}

function stripAnsi(text: string): string {
    // Remove ANSI escape codes - both the ESC[ format and the literal bracket format
    return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[(\d+)m/g, '');
}

function parsePerfFromLines(lines: string[]): PerfEntry[] {
    const entries: PerfEntry[] = [];

    // Match patterns like: "vite:load 7776.91ms [fs] /path/to/file"
    // or "vite:transform 1234.56ms /path/to/file"
    const timePattern = /(\d+\.\d+)ms/;
    const operationPattern = /vite:(load|transform|resolve|time|import-analysis)/;

    for (let line of lines) {
        // Strip ANSI color codes
        line = stripAnsi(line);

        const timeMatch = line.match(timePattern);
        const operationMatch = line.match(operationPattern);

        if (timeMatch && operationMatch) {
            const time = parseFloat(timeMatch[1]);
            const operation = operationMatch[1];

            // Extract file path - it's usually after the timing and optional [fs]/[plugin] marker
            let file = 'unknown';
            // Match file paths after [fs] or [plugin] or directly after timing
            const pathMatch = line.match(/(?:\[(?:fs|plugin)\]\s+)?([/\\]?[\w/.@-]+\.[a-z]+(?:\?[^\s]*)?)/i);
            if (pathMatch) {
                file = pathMatch[1];
                // Normalize path separators
                file = file.replace(/\\/g, '/');
                // Remove query params
                file = file.replace(/\?.*$/, '');
                // Get just the filename for cleaner output
                const fileName = path.basename(file);
                if (file.includes('node_modules')) {
                    const nodeModulesMatch = file.match(/node_modules\/([^\/]+)/);
                    if (nodeModulesMatch) {
                        file = `npm:${nodeModulesMatch[1]}/${fileName}`;
                    }
                } else if (file.includes('packages/')) {
                    const packagesMatch = file.match(/packages\/([^\/]+)/);
                    if (packagesMatch) {
                        file = `pkg:${packagesMatch[1]}/${fileName}`;
                    }
                } else if (file.includes('.cache/vite/deps/')) {
                    const depsMatch = file.match(/deps\/([^?]+)/);
                    if (depsMatch) {
                        file = `deps:${depsMatch[1]}`;
                    }
                } else if (file.startsWith('/')) {
                    // Remove leading /src/ or similar
                    file = file.replace(/^\/src\//, '');
                    if (!file.includes('/')) {
                        file = fileName;
                    }
                } else {
                    file = fileName;
                }
            }

            entries.push({
                operation,
                time,
                file,
                fullLine: line.trim()
            });
        }
    }

    return entries;
}

function analyzePerf(entries: PerfEntry[]) {
    console.log('\n📊 VITE PERFORMANCE ANALYSIS\n');
    console.log('='.repeat(80));

    // Top 20 slowest individual operations
    console.log('\n🐌 TOP 20 SLOWEST OPERATIONS:\n');
    const sorted = [...entries].sort((a, b) => b.time - a.time).slice(0, 20);
    sorted.forEach((entry, i) => {
        console.log(`${String(i + 1).padStart(2)}. ${(entry.time / 1000).toFixed(2).padStart(6)}s  [${entry.operation.padEnd(15)}] ${entry.file}`);
    });

    // Aggregate by operation type
    console.log('\n⚙️  BY OPERATION TYPE:\n');
    const byOperation = new Map<string, AggregatedStats>();
    for (const entry of entries) {
        if (!byOperation.has(entry.operation)) {
            byOperation.set(entry.operation, { totalTime: 0, count: 0, files: [] });
        }
        const stats = byOperation.get(entry.operation)!;
        stats.totalTime += entry.time;
        stats.count++;
    }

    const operationsSorted = Array.from(byOperation.entries())
        .sort((a, b) => b[1].totalTime - a[1].totalTime);

    operationsSorted.forEach(([op, stats]) => {
        const avgTime = stats.totalTime / stats.count;
        console.log(`${op.padEnd(20)} ${(stats.totalTime / 1000).toFixed(1).padStart(6)}s total  (${stats.count.toString().padStart(4)} ops, ${(avgTime / 1000).toFixed(3)}s avg)`);
    });

    // Aggregate by package/category
    console.log('\n📦 BY PACKAGE/CATEGORY:\n');
    const byPackage = new Map<string, AggregatedStats>();
    for (const entry of entries) {
        let category = 'Other';

        // Check package prefixes first
        if (entry.file.startsWith('pkg:ckeditor5')) {
            category = 'CKEditor Core';
        } else if (entry.file.startsWith('pkg:')) {
            category = entry.file.split('/')[0];
        } else if (entry.file.startsWith('deps:ckeditor5-premium')) {
            category = 'CKEditor Premium';
        } else if (entry.file.startsWith('deps:ckeditor5')) {
            category = 'CKEditor Core (deps)';
        } else if (entry.file.startsWith('deps:@codemirror')) {
            category = 'CodeMirror';
        } else if (entry.file.startsWith('deps:')) {
            category = 'Dependencies';
        }
        // Break down app source files
        else if (entry.file.includes('widgets/')) {
            if (entry.file.includes('type_widgets/')) {
                category = 'App: Type Widgets';
            } else if (entry.file.includes('collections/')) {
                category = 'App: Collections';
            } else if (entry.file.includes('ribbon/')) {
                category = 'App: Ribbon';
            } else if (entry.file.includes('dialogs/')) {
                category = 'App: Dialogs';
            } else if (entry.file.includes('launch_bar/')) {
                category = 'App: Launch Bar';
            } else {
                category = 'App: Widgets';
            }
        } else if (entry.file.includes('services/')) {
            category = 'App: Services';
        } else if (entry.file.includes('components/')) {
            category = 'App: Components';
        } else if (entry.file.includes('menus/')) {
            category = 'App: Menus';
        } else if (entry.file.includes('.css')) {
            category = 'CSS';
        } else if (entry.file.match(/\.(png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot)$/i)) {
            category = 'Assets';
        }

        if (!byPackage.has(category)) {
            byPackage.set(category, { totalTime: 0, count: 0, files: [] });
        }
        const stats = byPackage.get(category)!;
        stats.totalTime += entry.time;
        stats.count++;
        if (!stats.files.includes(entry.file)) {
            stats.files.push(entry.file);
        }
    }

    const packagesSorted = Array.from(byPackage.entries())
        .sort((a, b) => b[1].totalTime - a[1].totalTime);

    packagesSorted.forEach(([pkg, stats]) => {
        console.log(`${pkg.padEnd(30)} ${(stats.totalTime / 1000).toFixed(1).padStart(6)}s  (${stats.count.toString().padStart(4)} files)`);
    });

    // CKEditor breakdown
    console.log('\n✏️  CKEDITOR PLUGIN BREAKDOWN:\n');
    const ckeditorEntries = entries.filter(e =>
        e.file.includes('ckeditor5') &&
        (e.file.includes('admonition') ||
         e.file.includes('footnotes') ||
         e.file.includes('math') ||
         e.file.includes('mermaid') ||
         e.file.includes('keyboard-marker'))
    );

    const byCKPlugin = new Map<string, AggregatedStats>();
    for (const entry of ckeditorEntries) {
        let plugin = 'unknown';
        if (entry.file.includes('admonition')) plugin = 'admonition';
        else if (entry.file.includes('footnotes')) plugin = 'footnotes';
        else if (entry.file.includes('math')) plugin = 'math';
        else if (entry.file.includes('mermaid')) plugin = 'mermaid';
        else if (entry.file.includes('keyboard-marker')) plugin = 'keyboard-marker';

        if (!byCKPlugin.has(plugin)) {
            byCKPlugin.set(plugin, { totalTime: 0, count: 0, files: [] });
        }
        const stats = byCKPlugin.get(plugin)!;
        stats.totalTime += entry.time;
        stats.count++;
    }

    const pluginsSorted = Array.from(byCKPlugin.entries())
        .sort((a, b) => b[1].totalTime - a[1].totalTime);

    pluginsSorted.forEach(([plugin, stats]) => {
        console.log(`${plugin.padEnd(20)} ${(stats.totalTime / 1000).toFixed(1).padStart(6)}s  (${stats.count} files)`);
    });

    // Summary stats
    const totalTime = entries.reduce((sum, e) => sum + e.time, 0);
    const totalOps = entries.length;

    console.log('\n📈 SUMMARY:\n');
    console.log(`Total operations:  ${totalOps}`);
    console.log(`Total time:        ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`Average per op:    ${(totalTime / totalOps).toFixed(1)}ms`);
    console.log(`Operations > 500ms: ${entries.filter(e => e.time > 500).length}`);
    console.log(`Operations > 1000ms: ${entries.filter(e => e.time > 1000).length}`);
    console.log(`Operations > 3000ms: ${entries.filter(e => e.time > 3000).length}`);

    console.log('\n' + '='.repeat(80) + '\n');
}

// Helper to make HTTP request to trigger Vite rendering
async function makeHttpRequest(): Promise<void> {
    return new Promise((resolve) => {
        console.log('\n🌐 Making request to http://localhost:8080 to trigger Vite...');

        const req = http.get('http://localhost:8080', (res: http.IncomingMessage) => {
            console.log(`   ✅ Response status: ${res.statusCode}`);
            console.log(`   Response headers:`, res.headers);

            let body = '';
            res.on('data', (chunk: Buffer | string) => {
                body += chunk;
            });

            res.on('end', () => {
                console.log(`   Response body length: ${body.length} bytes`);
                if (body.length < 1000) {
                    console.log(`   Response body: ${body}`);
                } else {
                    console.log(`   Response body preview (first 500 chars):\n${body.substring(0, 500)}`);
                }
                resolve();
            });
        });

        req.on('error', (err: Error) => {
            console.log(`   ❌ Request failed: ${err.message}`);
            resolve(); // Continue anyway
        });

        req.setTimeout(5000, () => {
            console.log(`   ⏱️  Request timed out after 5 seconds`);
            req.destroy();
            resolve();
        });
    });
}

// Main - runs pnpm server:start and analyzes output automatically
async function runPerfAnalysis() {
    console.log('🚀 Starting pnpm server:start with DEBUG=vite:*...\n');
    console.log('⏳ This will take about 60 seconds...\n');

    const lines: string[] = [];
    let dataCount = 0;

    return new Promise<void>((resolve, reject) => {
        const child = spawn('pnpm', ['server:start'], {
            env: {
                ...process.env,
                DEBUG: 'vite:*',
                TRILIUM_GENERAL_NOAUTHENTICATION: '1'
            },
            shell: true,
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');

        let lastActivityTime = Date.now();
        let maxTimeoutHandle: NodeJS.Timeout;
        let inactivityCheckInterval: NodeJS.Timeout;
        let serverStarted = false;

        const finishCollection = () => {
            clearTimeout(maxTimeoutHandle);
            clearInterval(inactivityCheckInterval);
            child.kill('SIGTERM');

            // Give it a moment to clean up
            setTimeout(() => {
                const elapsedSeconds = ((Date.now() - lastActivityTime) / 1000).toFixed(1);
                console.log('\n\n✅ Collected output, analyzing...\n');
                console.log(`   Received ${dataCount} data chunks, ${lines.length} lines`);
                console.log(`   Last activity was ${elapsedSeconds}s ago`);

                const entries = parsePerfFromLines(lines);
                console.log(`📊 Found ${entries.length} performance entries`);

                if (entries.length === 0) {
                    console.error('❌ No performance data found');
                    console.error('   Expected lines like: "vite:load 123.45ms [fs] /path/to/file"');
                    console.error(`\n   Sample lines collected (first 20):`);
                    lines.slice(0, 20).forEach(line => {
                        if (line.trim()) console.error(`   "${line}"`);
                    });
                    reject(new Error('No performance data found'));
                    return;
                }

                analyzePerf(entries);
                resolve();
            }, 1000);
        };

        child.stdout?.on('data', (data) => {
            dataCount++;
            lastActivityTime = Date.now();
            const text = String(data);
            lines.push(...text.split('\n'));
            process.stdout.write('.');

            // Check if server has started
            if (!serverStarted && text.includes('Listening on')) {
                serverStarted = true;
                // Wait 2 seconds for Vite to initialize, then make a request
                setTimeout(async () => {
                    await makeHttpRequest();
                }, 2000);
            }
        });

        child.stderr?.on('data', (data) => {
            dataCount++;
            lastActivityTime = Date.now();
            const text = String(data);
            lines.push(...text.split('\n'));
            process.stdout.write('.');
        });

        // Maximum timeout of 60 seconds
        maxTimeoutHandle = setTimeout(() => {
            console.log('\n⏱️  Reached 60 second maximum timeout');
            finishCollection();
        }, 60000);

        // Check every second for 10 seconds of inactivity
        inactivityCheckInterval = setInterval(() => {
            const inactiveSeconds = (Date.now() - lastActivityTime) / 1000;
            if (inactiveSeconds >= 10) {
                console.log('\n⏱️  No activity for 10 seconds, finishing...');
                finishCollection();
            }
        }, 1000);

        child.on('error', (error) => {
            console.error(`❌ Failed to start process: ${error.message}`);
            reject(error);
        });
    });
}

runPerfAnalysis().catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
});
