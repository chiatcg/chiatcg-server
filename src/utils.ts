import './extensions';

export const FULL_DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss';
export const DATE_FORMAT = 'YYYY-MM-DD';
export const SECS_IN_MIN = 60;
export const MINS_IN_HOUR = 60;
export const HOURS_IN_DAY = 24;
export const SECS_IN_HOUR = SECS_IN_MIN * MINS_IN_HOUR;
export const MINS_IN_DAY = MINS_IN_HOUR * HOURS_IN_DAY;
export const SECS_IN_DAY = MINS_IN_DAY * SECS_IN_MIN;

export const jsonReplacer = (_: string, value: any) => {
    if (value instanceof Map) {
        return {
            __reviverType: 'map',
            value: Object.fromEntries(value.entries()),
        };
    }
    return value;
};

export const jsonReviver = (_: string, value: any) => {
    if (value?.__reviverType === 'map') {
        return new Map(Object.entries(value.value));
    }
    return value;
};

export const clamp = (value: number, min: number, max: number) => {
    return value < min ? min : (value > max) ? max : value;
}

export const rand = (minIncl: number, maxExcl: number) =>
    minIncl + Math.random() * (maxExcl - minIncl);

export const randInt = (min: number, max: number) =>
    Math.round(rand(min, max));

export const round = (num: number, precision: number) =>
    +num.toFixed(precision);