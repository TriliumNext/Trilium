export function formatLogMessage(message: string | object) {
    if (typeof message === "object") {
        try {
            return JSON.stringify(message, null, 4);
        } catch (e) {
            return message.toString();
        }
    }

    return message;
}
