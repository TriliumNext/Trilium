export default class LogService {

    log(message: string | Error) {
        console.log(message);
    }

    info(message: string | Error) {
        console.info(message);
    }

    error(message: string | Error | unknown) {
        console.error("ERROR: ", message);
    }

}

let log: LogService;

export function initLog() {
    log = new LogService();
}

export function getLog() {
    if (!log) throw new Error("Log service not initialized.");
    return log;
}
