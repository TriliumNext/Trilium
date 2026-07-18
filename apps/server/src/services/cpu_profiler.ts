import fs from "fs";
import inspector from "inspector";
import path from "path";

/**
 * Starts the V8 CPU profiler when TRILIUM_PROFILE is set, returning the inspector session (or null when
 * profiling is disabled). The companion {@link writeCpuProfile} stops it and writes the `.cpuprofile`.
 *
 * We drive the profiler ourselves rather than relying on Node's --cpu-prof flag: that flag flushes its file
 * during the normal shutdown path, which the server's exit handler short-circuits with process.exit(0), so
 * the profile would silently never be written.
 */
export function startCpuProfiler(): inspector.Session | null {
    if (!process.env.TRILIUM_PROFILE) {
        return null;
    }

    const session = new inspector.Session();
    session.connect();
    session.post("Profiler.enable", () => {
        session.post("Profiler.start", () => {
            console.log("CPU profiler started (TRILIUM_PROFILE). Press Enter in this terminal to write the profile and exit.");
        });
    });

    return session;
}

/**
 * Stops the profiler started by {@link startCpuProfiler}, writes the result into `profiles/` (relative to the
 * working directory), then invokes `done`. When profiling is disabled, or if writing fails, `done` still runs
 * so shutdown is never blocked.
 */
export function writeCpuProfile(session: inspector.Session | null, done: () => void) {
    if (!session) {
        done();
        return;
    }

    // Don't let a stuck profiler hang shutdown — exit anyway after a short grace period.
    const fallback = setTimeout(done, 3000);

    session.post("Profiler.stop", (err, result) => {
        clearTimeout(fallback);
        try {
            if (err) {
                throw err;
            }
            const dir = path.resolve("profiles");
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `import-${process.pid}.cpuprofile`);
            fs.writeFileSync(file, JSON.stringify(result.profile));
            console.log(`CPU profile written to ${file}`);
        } catch (e) {
            console.error("Failed to write CPU profile:", e);
        } finally {
            session.disconnect();
            done();
        }
    });
}
