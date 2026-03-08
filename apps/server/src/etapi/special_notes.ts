import type { Router } from "express";

import dateNotesService from "../services/date_notes.js";
import specialNotesService from "../services/special_notes.js";
import eu from "./etapi_utils.js";
import mappers from "./mappers.js";

const getDateInvalidError = (date: string) => new eu.EtapiError(400, "DATE_INVALID", `Date "${date}" is not valid.`);
const getWeekInvalidError = (week: string) => new eu.EtapiError(400, "WEEK_INVALID", `Week "${week}" is not valid.`);
const getWeekNotFoundError = (week: string) => new eu.EtapiError(404, "WEEK_NOT_FOUND", `Week "${week}" not found. Check if week note is enabled.`);
const getMonthInvalidError = (month: string) => new eu.EtapiError(400, "MONTH_INVALID", `Month "${month}" is not valid.`);
const getYearInvalidError = (year: string) => new eu.EtapiError(400, "YEAR_INVALID", `Year "${year}" is not valid.`);

function isValidDate(date: string) {
    return /[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(date) && !!Date.parse(date);
}

function register(router: Router) {
    eu.route<{ date: string }>(router, "get", "/etapi/inbox/:date", (req, res, next) => {
        const { date } = req.params;

        if (!isValidDate(date)) {
            throw getDateInvalidError(date);
        }
        const note = specialNotesService.getInboxNote(date);
        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ date: string }>(router, "get", "/etapi/calendar/days/:date", (req, res, next) => {
        const { date } = req.params;

        if (!isValidDate(date)) {
            throw getDateInvalidError(date);
        }

        const note = dateNotesService.getDayNote(date);
        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ date: string }>(router, "get", "/etapi/calendar/week-first-day/:date", (req, res, next) => {
        const { date } = req.params;

        if (!isValidDate(date)) {
            throw getDateInvalidError(date);
        }

        const note = dateNotesService.getWeekFirstDayNote(date);
        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ week: string }>(router, "get", "/etapi/calendar/weeks/:week", (req, res, next) => {
        const { week } = req.params;

        if (!/[0-9]{4}-W[0-9]{2}/.test(week)) {
            throw getWeekInvalidError(week);
        }

        const note = dateNotesService.getWeekNote(week);

        if (!note) {
            throw getWeekNotFoundError(week);
        }

        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ month: string }>(router, "get", "/etapi/calendar/months/:month", (req, res, next) => {
        const { month } = req.params;

        if (!/[0-9]{4}-[0-9]{2}/.test(month)) {
            throw getMonthInvalidError(month);
        }

        const note = dateNotesService.getMonthNote(month);
        res.json(mappers.mapNoteToPojo(note));
    });

    eu.route<{ year: string }>(router, "get", "/etapi/calendar/years/:year", (req, res, next) => {
        const { year } = req.params;

        if (!/[0-9]{4}/.test(year)) {
            throw getYearInvalidError(year);
        }

        const note = dateNotesService.getYearNote(year);
        res.json(mappers.mapNoteToPojo(note));
    });
}

export default {
    register
};
