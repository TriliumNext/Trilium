import { dayjs } from "@triliumnext/commons";
import cls from "./cls.js";

const LOCAL_DATETIME_FORMAT = "YYYY-MM-DD HH:mm:ss.SSSZZ";
const UTC_DATETIME_FORMAT = "YYYY-MM-DD HH:mm:ssZ";

function utcNowDateTime() {
    return utcDateTimeStr(new Date());
}

// CLS date time is important in web deployments - server often runs in different time zone than user is located in,
// so we'd prefer client timezone to be used to record local dates. For this reason, requests from clients contain
// "trilium-local-now-datetime" header which is then stored in CLS
function localNowDateTime() {
    return cls.getLocalNowDateTime() || dayjs().format(LOCAL_DATETIME_FORMAT);
}

function localNowDate() {
    const clsDateTime = cls.getLocalNowDateTime();

    if (clsDateTime) {
        return clsDateTime.substr(0, 10);
    } else {
        const date = new Date();

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
}

function pad(num: number) {
    return num <= 9 ? `0${num}` : `${num}`;
}

function utcDateStr(date: Date) {
    return date.toISOString().split("T")[0];
}

function utcDateTimeStr(date: Date) {
    return date.toISOString().replace("T", " ");
}

/**
 * @param str - needs to be in the ISO 8601 format "YYYY-MM-DDTHH:MM:SS.sssZ" format as outputted by dateStr().
 *              also is assumed to be GMT time (as indicated by the "Z" at the end), *not* local time
 */
function parseDateTime(str: string) {
    try {
        return new Date(Date.parse(str));
    } catch (e: any) {
        throw new Error(`Can't parse date from '${str}': ${e.stack}`);
    }
}

function parseLocalDate(str: string) {
    const datePart = str.substr(0, 10);

    // not specifying the timezone and specifying the time means Date.parse() will use the local timezone
    return parseDateTime(`${datePart} 12:00:00.000`);
}

function getDateTimeForFile() {
    return new Date().toISOString().substr(0, 19).replace(/:/g, "");
}

function validateLocalDateTime(str: string | null | undefined) {
    if (!str) {
        return;
    }

    if (!/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}[+-][0-9]{4}/.test(str)) {
        return `Invalid local date time format in '${str}'. Correct format shoud follow example: '2023-08-21 23:38:51.110+0200'`;
    }

    if (!dayjs(str, LOCAL_DATETIME_FORMAT)) {
        return `Date '${str}' appears to be in the correct format, but cannot be parsed. It likely represents an invalid date.`;
    }
}

function validateUtcDateTime(str: string | undefined) {
    if (!str) {
        return;
    }

    if (!/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/.test(str)) {
        return `Invalid UTC date time format in '${str}'. Correct format shoud follow example: '2023-08-21 23:38:51.110Z'`;
    }

    if (!dayjs(str, UTC_DATETIME_FORMAT)) {
        return `Date '${str}' appears to be in the correct format, but cannot be parsed. It likely represents an invalid date.`;
    }
}

export default {
    LOCAL_DATETIME_FORMAT,
    UTC_DATETIME_FORMAT,
    utcNowDateTime,
    localNowDateTime,
    localNowDate,

    utcDateStr,
    utcDateTimeStr,
    parseDateTime,
    parseLocalDate,
    getDateTimeForFile,
    validateLocalDateTime,
    validateUtcDateTime
};
