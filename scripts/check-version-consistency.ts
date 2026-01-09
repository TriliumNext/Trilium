import { readFileSync } from "fs";
import { join } from "path";

const projectRoot = join(__dirname, '..');
const filesToCheck = [
    'package.json',
    'apps/server/package.json',
    'apps/client/package.json',
    'apps/desktop/package.json',
    'packages/commons/package.json',
]

function main() {
    const expectedVersion = process.argv[2];
    if (!expectedVersion) {
        console.error('Expected version argument is missing.');
        process.exit(1);
    }

    for (const fileToCheck of filesToCheck) {
        const packageJsonPath = join(projectRoot, fileToCheck);
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const version = packageJson.version;
        if (version !== expectedVersion) {
            console.error(`Version mismatch in ${fileToCheck}: expected ${expectedVersion}, found ${version}`);
            process.exit(1);
        }
    }

    console.log('All versions are consistent:', expectedVersion);
}

main();
