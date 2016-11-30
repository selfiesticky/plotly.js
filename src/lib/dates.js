/**
* Copyright 2012-2016, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var calendars = require('world-calendars');
var d3 = require('d3');
var isNumeric = require('fast-isnumeric');

var logError = require('./loggers').error;
var mod = require('./mod');

var constants = require('../constants/numerical');
var BADNUM = constants.BADNUM;
var ONEDAY = constants.ONEDAY;
var ONEHOUR = constants.ONEHOUR;
var ONEMIN = constants.ONEMIN;
var ONESEC = constants.ONESEC;

var utcFormat = d3.time.format.utc;

var DATETIME_REGEXP = /^\s*(-?\d\d\d\d|\d\d)(-(\d?\d)(-(\d?\d)([ Tt]([01]?\d|2[0-3])(:([0-5]\d)(:([0-5]\d(\.\d+)?))?(Z|z|[+\-]\d\d:?\d\d)?)?)?)?)?\s*$/m;

// for 2-digit years, the first year we map them onto
var YFIRST = new Date().getFullYear() - 70;

// cache world calendars, so we don't have to reinstantiate
// during each date-time conversion
var allCals = {};
function getCal(calendar) {
    var calendarObj = allCals[calendar];
    if(calendarObj) return calendarObj;

    calendarObj = allCals[calendar] = calendars.instance(calendar);
    return calendarObj;
}

function isWorldCalendar(calendar) {
    return calendar && typeof calendar === 'string' && calendar !== 'gregorian';
}

// For fast conversion btwn world calendars and epoch ms, the Julian Day Number
// of the unix epoch. From calendars.instance().newDate(1970, 1, 1).toJD()
var EPOCHJD = 2440587.5;

// is an object a javascript date?
exports.isJSDate = function(v) {
    return typeof v === 'object' && v !== null && typeof v.getTime === 'function';
};

// The absolute limits of our date-time system
// This is a little weird: we use MIN_MS and MAX_MS in dateTime2ms
// but we use dateTime2ms to calculate them (after defining it!)
var MIN_MS, MAX_MS;

/**
 * dateTime2ms - turn a date object or string s into milliseconds
 * (relative to 1970-01-01, per javascript standard)
 * optional calendar (string) to use a non-gregorian calendar
 *
 * Returns BADNUM if it doesn't find a date
 *
 * strings should have the form:
 *
 *    -?YYYY-mm-dd<sep>HH:MM:SS.sss<tzInfo>?
 *
 * <sep>: space (our normal standard) or T or t (ISO-8601)
 * <tzInfo>: Z, z, or [+\-]HH:?MM and we THROW IT AWAY
 * this format comes from https://tools.ietf.org/html/rfc3339#section-5.6
 * but we allow it even with a space as the separator
 *
 * May truncate after any full field, and sss can be any length
 * even >3 digits, though javascript dates truncate to milliseconds,
 * we keep as much as javascript numeric precision can hold, but we only
 * report back up to 100 microsecond precision, because most dates support
 * this precision (close to 1970 support more, very far away support less)
 *
 * Expanded to support negative years to -9999 but you must always
 * give 4 digits, except for 2-digit positive years which we assume are
 * near the present time.
 * Note that we follow ISO 8601:2004: there *is* a year 0, which
 * is 1BC/BCE, and -1===2BC etc.
 *
 * Where to cut off 2-digit years between 1900s and 2000s?
 * from http://support.microsoft.com/kb/244664:
 *   1930-2029 (the most retro of all...)
 * but in my mac chrome from eg. d=new Date(Date.parse('8/19/50')):
 *   1950-2049
 * by Java, from http://stackoverflow.com/questions/2024273/:
 *   now-80 - now+19
 * or FileMaker Pro, from
 *      http://www.filemaker.com/12help/html/add_view_data.4.21.html:
 *   now-70 - now+29
 * but python strptime etc, via
 *      http://docs.python.org/py3k/library/time.html:
 *   1969-2068 (super forward-looking, but static, not sliding!)
 *
 * lets go with now-70 to now+29, and if anyone runs into this problem
 * they can learn the hard way not to use 2-digit years, as no choice we
 * make now will cover all possibilities. mostly this will all be taken
 * care of in initial parsing, should only be an issue for hand-entered data
 * currently (2016) this range is:
 *   1946-2045
 */
exports.dateTime2ms = function(s, calendar) {
    // first check if s is a date object
    if(exports.isJSDate(s)) {
        // Convert to the UTC milliseconds that give the same
        // hours as this date has in the local timezone
        s = Number(s) - s.getTimezoneOffset() * ONEMIN;
        if(s >= MIN_MS && s <= MAX_MS) return s;
        return BADNUM;
    }
    // otherwise only accept strings and numbers
    if(typeof s !== 'string' && typeof s !== 'number') return BADNUM;

    var match = String(s).match(DATETIME_REGEXP);
    if(!match) return BADNUM;
    var y = match[1],
        m = Number(match[3] || 1),
        d = Number(match[5] || 1),
        H = Number(match[7] || 0),
        M = Number(match[9] || 0),
        S = Number(match[11] || 0);

    if(isWorldCalendar(calendar)) {
        // disallow 2-digit years for world calendars
        if(y.length === 2) return BADNUM;

        var cDate = getCal(calendar).newDate(Number(y), m, d);
        if(!cDate) return BADNUM;

        return ((cDate.toJD() - EPOCHJD) * ONEDAY) +
            (H * ONEHOUR) + (M * ONEMIN) + (S * ONESEC);
    }

    if(y.length === 2) {
        y = (Number(y) + 2000 - YFIRST) % 100 + YFIRST;
    }
    else y = Number(y);

    // new Date uses months from 0; subtract 1 here just so we
    // don't have to do it again during the validity test below
    m -= 1;

    // javascript takes new Date(0..99,m,d) to mean 1900-1999, so
    // to support years 0-99 we need to use setFullYear explicitly
    // Note that 2000 is a leap year.
    var date = new Date(Date.UTC(2000, m, d, H, M));
    date.setUTCFullYear(y);

    if(date.getUTCMonth() !== m) return BADNUM;
    if(date.getUTCDate() !== d) return BADNUM;

    return date.getTime() + S * ONESEC;
};

MIN_MS = exports.MIN_MS = exports.dateTime2ms('-9999');
MAX_MS = exports.MAX_MS = exports.dateTime2ms('9999-12-31 23:59:59.9999');

// is string s a date? (see above)
exports.isDateTime = function(s, calendar) {
    return (exports.dateTime2ms(s, calendar) !== BADNUM);
};

// pad a number with zeroes, to given # of digits before the decimal point
function lpad(val, digits) {
    return String(val + Math.pow(10, digits)).substr(1);
}

/**
 * Turn ms into string of the form YYYY-mm-dd HH:MM:SS.ssss
 * Crop any trailing zeros in time, except never stop right after hours
 * (we could choose to crop '-01' from date too but for now we always
 * show the whole date)
 * Optional range r is the data range that applies, also in ms.
 * If rng is big, the later parts of time will be omitted
 */
var NINETYDAYS = 90 * ONEDAY;
var THREEHOURS = 3 * ONEHOUR;
var FIVEMIN = 5 * ONEMIN;
exports.ms2DateTime = function(ms, r, calendar) {
    if(typeof ms !== 'number' || !(ms >= MIN_MS && ms <= MAX_MS)) return BADNUM;

    if(!r) r = 0;

    var msecTenths = Math.floor(mod(ms + 0.05, 1) * 10),
        msRounded = Math.round(ms - msecTenths / 10),
        dateStr, h, m, s, msec10;

    if(isWorldCalendar(calendar)) {
        var dateJD = Math.floor(msRounded / ONEDAY) + EPOCHJD,
            timeMs = Math.floor(mod(ms, ONEDAY));
        dateStr = getCal(calendar).fromJD(dateJD).formatDate('yyyy-mm-dd');

        // yyyy does NOT guarantee 4-digit years. YYYY mostly does, but does
        // other things for a few calendars, so we can't trust it. Just pad
        // it manually (after the '-' if there is one)
        if(dateStr.charAt(0) === '-') {
            while(dateStr.length < 11) dateStr = '-0' + dateStr.substr(1);
        }
        else {
            while(dateStr.length < 10) dateStr = '0' + dateStr;
        }

        // TODO: if this is faster, we could use this block for extracting
        // the time components of regular gregorian too
        h = (r < NINETYDAYS) ? Math.floor(timeMs / ONEHOUR) : 0;
        m = (r < NINETYDAYS) ? Math.floor((timeMs % ONEHOUR) / ONEMIN) : 0;
        s = (r < THREEHOURS) ? Math.floor((timeMs % ONEMIN) / ONESEC) : 0;
        msec10 = (r < FIVEMIN) ? (timeMs % ONESEC) * 10 + msecTenths : 0;
    }
    else {
        var d = new Date(msRounded);

        dateStr = utcFormat('%Y-%m-%d')(d);

        // <90 days: add hours and minutes - never *only* add hours
        h = (r < NINETYDAYS) ? d.getUTCHours() : 0;
        m = (r < NINETYDAYS) ? d.getUTCMinutes() : 0;
        // <3 hours: add seconds
        s = (r < THREEHOURS) ? d.getUTCSeconds() : 0;
        // <5 minutes: add ms (plus one extra digit, this is msec*10)
        msec10 = (r < FIVEMIN) ? d.getUTCMilliseconds() * 10 + msecTenths : 0;
    }

    return includeTime(dateStr, h, m, s, msec10);
};

// For converting old-style milliseconds to date strings,
// we use the local timezone rather than UTC like we use
// everywhere else, both for backward compatibility and
// because that's how people mostly use javasript date objects.
// Clip one extra day off our date range though so we can't get
// thrown beyond the range by the timezone shift.
exports.ms2DateTimeLocal = function(ms) {
    if(!(ms >= MIN_MS + ONEDAY && ms <= MAX_MS - ONEDAY)) return BADNUM;

    var msecTenths = Math.floor(mod(ms + 0.05, 1) * 10),
        d = new Date(Math.round(ms - msecTenths / 10)),
        dateStr = d3.time.format('%Y-%m-%d')(d),
        h = d.getHours(),
        m = d.getMinutes(),
        s = d.getSeconds(),
        msec10 = d.getUTCMilliseconds() * 10 + msecTenths;

    return includeTime(dateStr, h, m, s, msec10);
};

function includeTime(dateStr, h, m, s, msec10) {
    // include each part that has nonzero data in or after it
    if(h || m || s || msec10) {
        dateStr += ' ' + lpad(h, 2) + ':' + lpad(m, 2);
        if(s || msec10) {
            dateStr += ':' + lpad(s, 2);
            if(msec10) {
                var digits = 4;
                while(msec10 % 10 === 0) {
                    digits -= 1;
                    msec10 /= 10;
                }
                dateStr += '.' + lpad(msec10, digits);
            }
        }
    }
    return dateStr;
}

// normalize date format to date string, in case it starts as
// a Date object or milliseconds
// optional dflt is the return value if cleaning fails
exports.cleanDate = function(v, dflt, calendar) {
    if(exports.isJSDate(v) || typeof v === 'number') {
        // do not allow milliseconds (old) or jsdate objects (inherently
        // described as gregorian dates) with world calendars
        if(isWorldCalendar(calendar)) {
            logError('JS Dates and milliseconds are incompatible with world calendars', v);
            return dflt;
        }

        // NOTE: if someone puts in a year as a number rather than a string,
        // this will mistakenly convert it thinking it's milliseconds from 1970
        // that is: '2012' -> Jan. 1, 2012, but 2012 -> 2012 epoch milliseconds
        v = exports.ms2DateTimeLocal(+v);
        if(!v && dflt !== undefined) return dflt;
    }
    else if(!exports.isDateTime(v, calendar)) {
        logError('unrecognized date', v);
        return dflt;
    }
    return v;
};

/*
 *  Date formatting for ticks and hovertext
 */

/*
 * convert d3 templates to world-calendars templates, so our users only need
 * to know d3's specifiers. Map space padding to no padding, and unknown fields
 * to an ugly placeholder
 */
var UNKNOWN = '##';
var d3ToWorldCalendars = {
    'd': {'0': 'dd', '-': 'd'}, // 2-digit or unpadded day of month
    'a': {'0': 'D', '-': 'D'}, // short weekday name
    'A': {'0': 'DD', '-': 'DD'}, // full weekday name
    'j': {'0': 'oo', '-': 'o'}, // 3-digit or unpadded day of the year
    'W': {'0': 'ww', '-': 'w'}, // 2-digit or unpadded week of the year (Monday first)
    'm': {'0': 'mm', '-': 'm'}, // 2-digit or unpadded month number
    'b': {'0': 'M', '-': 'M'}, // short month name
    'B': {'0': 'MM', '-': 'MM'}, // full month name
    'y': {'0': 'yy', '-': 'yy'}, // 2-digit year (map unpadded to zero-padded)
    'Y': {'0': 'yyyy', '-': 'yyyy'}, // 4-digit year (map unpadded to zero-padded)
    'U': UNKNOWN, // Sunday-first week of the year
    'w': UNKNOWN, // day of the week [0(sunday),6]
    // combined format, we replace the date part with the world-calendar version
    // and the %X stays there for d3 to handle with time parts
    '%c': {'0': 'D M m %X yyyy', '-': 'D M m %X yyyy'},
    '%x': {'0': 'mm/dd/yyyy', '-': 'mm/dd/yyyy'}
};

function worldCalFmt(fmt, x, calendar) {
    var dateJD = Math.floor(x + 0.05 / ONEDAY) + EPOCHJD,
        cDate = getCal(calendar).fromJD(dateJD),
        i = 0,
        modifier, directive, directiveLen, directiveObj, replacementPart;
    while((i = fmt.indexOf('%', i)) !== -1) {
        modifier = fmt.charAt(i + 1);
        if(modifier === '0' || modifier === '-' || modifier === '_') {
            directiveLen = 3;
            directive = fmt.charAt(i + 1);
            if(modifier === '_') modifier = '-';
        }
        else {
            directive = modifier;
            modifier = '0';
            directiveLen = 2;
        }
        directiveObj = d3ToWorldCalendars[directive];
        if(!directiveObj) {
            i += directiveLen;
        }
        else {
            // code is recognized as a date part but world-calendars doesn't support it
            if(directiveObj === UNKNOWN) replacementPart = UNKNOWN;

            // format the cDate according to the translated directive
            else replacementPart = cDate.formatDate(directiveObj[modifier]);

            fmt = fmt.substr(0, i) + replacementPart + fmt.substr(i + directiveLen);
            i += replacementPart.length;
        }
    }
    return fmt;
}

/*
 * modDateFormat: Support world calendars, and add one item to
 * d3's vocabulary:
 * %{n}f where n is the max number of digits of fractional seconds
 */
var fracMatch = /%(\d?)f/g;
function modDateFormat(fmt, x, calendar) {
    var fm = fmt.match(fracMatch),
        d = new Date(x);
    if(fm) {
        var digits = Math.min(+fm[1] || 6, 6),
            fracSecs = String((x / 1000 % 1) + 2.0000005)
                .substr(2, digits).replace(/0+$/, '') || '0';
        fmt = fmt.replace(fracMatch, fracSecs);
    }
    if(isWorldCalendar(calendar)) {
        fmt = worldCalFmt(fmt, x, calendar);
    }
    return utcFormat(fmt)(d);
}

/*
 * formatTime: create a time string from:
 *   x: milliseconds
 *   tr: tickround ('M', 'S', or # digits)
 * only supports UTC times (where every day is 24 hours and 0 is at midnight)
 */
function formatTime(x, tr) {
    var timePart = mod(x, ONEDAY);

    var timeStr = lpad(Math.floor(timePart / ONEHOUR), 2) + ':' +
        lpad(mod(Math.floor(timePart / ONEMIN), 60), 2);

    if(tr !== 'M') {
        if(!isNumeric(tr)) tr = 0; // should only be 'S'
        timeStr += ':' + String(100 + d3.round(mod(x / ONESEC, 60), tr)).substr(1);
    }
    return timeStr;
}

var yearFormat = utcFormat('%Y'),
    monthFormat = utcFormat('%b %Y'),
    dayFormat = utcFormat('%b %-d'),
    yearMonthDayFormat = utcFormat('%b %-d, %Y');

function yearFormatWorld(cDate) { return cDate.formatDate('yyyy'); }
function monthFormatWorld(cDate) { return cDate.formatDate('M yyyy'); }
function dayFormatWorld(cDate) { return cDate.formatDate('M d'); }
function yearMonthDayFormatWorld(cDate) { return cDate.formatDate('M d, yyyy'); }

/*
 * formatDate: turn a date into tick or hover label text.
 *
 *   x: milliseconds, the value to convert
 *   fmt: optional, an explicit format string (d3 format, even for world calendars)
 *   tr: tickround ('y', 'm', 'd', 'M', 'S', or # digits)
 *      used if no explicit fmt is provided
 *   calendar: optional string, the world calendar system to use
 *
 * returns the date/time as a string, potentially with the leading portion
 * on a separate line (after '\n')
 * Note that this means if you provide an explicit format which includes '\n'
 * the axis may choose to strip things after it when they don't change from
 * one tick to the next (as it does with automatic formatting)
 */
exports.formatDate = function(x, fmt, tr, calendar) {
    var headStr,
        dateStr;

    calendar = isWorldCalendar(calendar) && calendar;

    if(fmt) return modDateFormat(fmt, x, calendar);

    if(calendar) {
        var dateJD = Math.floor(x + 0.05 / ONEDAY) + EPOCHJD,
            cDate = getCal(calendar).fromJD(dateJD);

        if(tr === 'y') dateStr = yearFormatWorld(cDate);
        else if(tr === 'm') dateStr = monthFormatWorld(cDate);
        else if(tr === 'd') {
            headStr = yearFormatWorld(cDate);
            dateStr = dayFormatWorld(cDate);
        }
        else {
            headStr = yearMonthDayFormatWorld(cDate);
            dateStr = formatTime(x, tr);
        }
    }
    else {
        var d = new Date(x);

        if(tr === 'y') dateStr = yearFormat(d);
        else if(tr === 'm') dateStr = monthFormat(d);
        else if(tr === 'd') {
            headStr = yearFormat(d);
            dateStr = dayFormat(d);
        }
        else {
            headStr = yearMonthDayFormat(d);
            dateStr = formatTime(x, tr);
        }
    }

    return dateStr + (headStr ? '\n' + headStr : '');
};
