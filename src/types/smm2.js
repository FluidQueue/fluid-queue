'use strict';

const settings = require('../settings.js');

const standardBase30 = '0123456789abcdefghijklmnopqrst';
const nintendoBase30 = '0123456789BCDFGHJKLMNPQRSTVWXY';
const arbitraryXorValue = 377544828;

const delim = '[-. ]?';
const code = '[A-Ha-hJ-Nj-nP-Yp-y0-9]{3}';
const codeStrict = '[A-Ha-hJ-Nj-nP-Yp-y0-9]{2}[fghFGH]';
const levelCodeRegex = new RegExp(`(${code})${delim}(${code})${delim}(${codeStrict})`);

// This function returns true if the course id given to it is a valid course id. The optional parameter dataIdThresHold
// will make the function return false if the data id of the submitted level is greater than it.
// For max data id threshold, if you only want to have a max maker id threshold, send the 2nd argument as null.
/**
 * @param {string} courseIdString
 * @param {number | undefined} dataIdCourseThreshold
 * @param {number | undefined} dataIdMakerThreshold
 */
function courseIdValidity(courseIdString, dataIdCourseThreshold, dataIdMakerThreshold) {
    // console.log(courseIdString);
    let reversedString = courseIdString.split("").reverse();
    reversedString = reversedString.map(c => standardBase30[nintendoBase30.indexOf(c)]).join('');
    let courseBits = parseInt(reversedString, 30);

    let courseBitsString = courseBits.toString(2);
    if (courseBitsString.length !== 44) {
        return { valid: false, makerCode: false };
    }
    let dataId = parseInt(courseBitsString.substring(32, 44).concat((courseBitsString.substring(10, 30))), 2) ^ arbitraryXorValue;
    let fieldA = parseInt(courseBitsString.substring(0, 4), 2);
    let fieldB = parseInt(courseBitsString.substring(4, 10), 2);
    let fieldD = parseInt(courseBitsString.substring(30, 31, 2));
    let fieldE = parseInt(courseBitsString.substring(31, 32, 2));

    if (fieldA !== 8 || fieldB !== (dataId - 31) % 64 || (fieldD == 0 && dataId < 3000004) || fieldE != 1) {
        return { valid: false, makerCode: fieldD == 1 };
    }
    else if (typeof dataIdMakerThreshold === 'number' && fieldD == 1) {
        return { valid: dataId <= dataIdMakerThreshold, makerCode: true };
    }
    else if (typeof dataIdCourseThreshold === 'number' && fieldD == 0) {
        return { valid: dataId <= dataIdCourseThreshold, makerCode: false };
    }

    return { valid: true, makerCode: fieldD == 1 };
}

// this function extracts a level code found in someones message
// and returns that level code (if possible) and also checks it's validity
// the returned object will contain
// - a `code` field which either contains the found level/maker code or the original message
// - a `valid` field which will be true iff a level/maker code has the correct syntax and is one that can be generated by the game
// - and a `validSyntax` field which will be true iff a level/maker code has the correct syntax
const extractValidCode = (levelCode) => {
    let match = levelCode.match(levelCodeRegex);
    if (match) {
        let courseIdString = `${match[1]}${match[2]}${match[3]}`.toUpperCase();
        let validity = courseIdValidity(courseIdString, settings.dataIdCourseThreshold, settings.dataIdMakerThreshold);
        return { ...validity, code: `${match[1]}-${match[2]}-${match[3]}`.toUpperCase(), validSyntax: true };
    }
    return { code: levelCode, valid: false, validSyntax: false, makerCode: false };
};

const makerSuffix = (levelCode) => {
    const makerCode = extractValidCode(levelCode).makerCode;
    // console.log(`"${levelCode}" -- ${makerCode}`);
    if (makerCode && settings.showMakerCode !== false) {
        return " (maker code)";
    }
    return "";
};

module.exports = {
    display(code) {
        return code + makerSuffix(code);
    },
    extractValidCode,
};