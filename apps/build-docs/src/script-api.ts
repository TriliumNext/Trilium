import { execSync } from "child_process";
import { join } from "path";

import BuildContext from "./context";

export default function buildScriptApi({ baseDir, gitRootDir }: BuildContext) {
    // Generate types
    execSync(`pnpm typecheck`, { stdio: "inherit", cwd: gitRootDir });

    for (const config of [ "backend", "frontend" ]) {
        const outDir = join(baseDir, "script-api", config);
        execSync(`pnpm typedoc --options typedoc.${config}.json --html "${outDir}"`, {
            stdio: "inherit"
        });
    }
}
