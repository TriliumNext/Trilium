const child_process = require("child_process");
const fs = require("fs");
const { rm } = require("fs/promises");
const path = require("path");

module.exports = async function (filePath) {
    const { WINDOWS_SIGN_EXECUTABLE, WINDOWS_SIGN_ERROR_LOG } = process.env;

    if (!WINDOWS_SIGN_EXECUTABLE) {
        console.warn("[Sign] Skip signing due to missing environment variable.");
        return;
    }

    const outputDir = path.join(__dirname, "sign");
    console.log("Output dir is ", path.resolve(outputDir));
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    const command = `${WINDOWS_SIGN_EXECUTABLE} --executable "${filePath}"`;
    console.log(`[Sign] Running ${command}`);

    let remainingTries = 10;
    let sleepTime = 10_000;
    while (remainingTries > 0) {
        // Delete the log file that might be blocking the signing.
        try {
            await rm(WINDOWS_SIGN_ERROR_LOG, {
                force: true
            })
        } catch (e) {
            console.error("[Sign] Unable to delete the log file.");
            process.exit(2);
        }

        // Run the signing.
        try {
            child_process.execSync(command);
            console.log(`[Sign] Signed ${filePath} successfully.`);
            break;
        } catch (e) {
            const output = e.stdout.toString("utf-8");
            console.warn(`[Sign] Unable to sign ${filePath} due to:\n${output}`);

            // Check if the error is retryable.
            if (!output.includes("http://timestamp.digicert.com")) {
                console.warn("Cannot retry due to unknown error.");
                process.exit(1);
            }

            console.info(`Waiting for ${sleepTime / 1000}s before retrying...`);
        }

        await sleep(sleepTime);
        sleepTime *= 2;
        remainingTries--;
    }

    if (remainingTries < 1) {
        console.error("Failed to sign.");
        process.exit(1);
    }

}

function sleep(time_ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, time_ms);
    });
}
