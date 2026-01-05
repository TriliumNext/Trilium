export default class LogService {

    log(message: string | Error) {
        console.log(message);
    }

    info(message: string | Error) {
        this.log(message);
    }

    error(message: string | Error | unknown) {
        this.log(`ERROR: ${message}`);
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
