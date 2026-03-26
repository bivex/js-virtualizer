/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-27 18:55
 * Last Updated: 2026-03-27 18:55
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const YEAR = DAY * 365.25;

// @virtualize
function ms(value, options) {
    options = options || {};
    const type = typeof value;

    if (type === "string" && value.length > 0) {
        return parse(value);
    }

    if (type === "number" && isFinite(value)) {
        return options.long ? formatLong(value) : formatShort(value);
    }

    throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(value)
    );
}

function parse(value) {
    const input = String(value);

    if (input.length > 100) {
        return undefined;
    }

    const match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(input);
    if (!match) {
        return undefined;
    }

    const amount = parseFloat(match[1]);
    const unit = (match[2] || "ms").toLowerCase();

    switch (unit) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
            return amount * YEAR;
        case "weeks":
        case "week":
        case "w":
            return amount * WEEK;
        case "days":
        case "day":
        case "d":
            return amount * DAY;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
            return amount * HOUR;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
            return amount * MINUTE;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
            return amount * SECOND;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
            return amount;
        default:
            return undefined;
    }
}

function formatShort(value) {
    const absoluteValue = Math.abs(value);

    if (absoluteValue >= DAY) {
        return Math.round(value / DAY) + "d";
    }

    if (absoluteValue >= HOUR) {
        return Math.round(value / HOUR) + "h";
    }

    if (absoluteValue >= MINUTE) {
        return Math.round(value / MINUTE) + "m";
    }

    if (absoluteValue >= SECOND) {
        return Math.round(value / SECOND) + "s";
    }

    return value + "ms";
}

function formatLong(value) {
    const absoluteValue = Math.abs(value);

    if (absoluteValue >= DAY) {
        return plural(value, absoluteValue, DAY, "day");
    }

    if (absoluteValue >= HOUR) {
        return plural(value, absoluteValue, HOUR, "hour");
    }

    if (absoluteValue >= MINUTE) {
        return plural(value, absoluteValue, MINUTE, "minute");
    }

    if (absoluteValue >= SECOND) {
        return plural(value, absoluteValue, SECOND, "second");
    }

    return value + " ms";
}

function plural(value, absoluteValue, unitSize, unitName) {
    const isPlural = absoluteValue >= unitSize * 1.5;
    return Math.round(value / unitSize) + " " + unitName + (isPlural ? "s" : "");
}

function recordCase(label, compute) {
    try {
        return {
            label,
            ok: true,
            value: compute()
        };
    } catch (error) {
        return {
            label,
            ok: false,
            error: error.message
        };
    }
}

const results = [
    recordCase("parse 2 days", () => ms("2 days")),
    recordCase("parse 1.5h", () => ms("1.5h")),
    recordCase("format short", () => ms(5400000)),
    recordCase("format long", () => ms(5400000, {long: true})),
    recordCase("negative format", () => ms(-1200, {long: true})),
    recordCase("invalid input", () => ms({oops: true}))
];

console.log(JSON.stringify(results, null, 2));
