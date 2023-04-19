/// <reference path='extensions.d.ts' />

Array.prototype.removeFirst = function (item) {
    const i = this.indexOf(item);
    if (i === -1) return false;
    this.splice(i, 1);
    return true;
};

Array.prototype.findAndRemoveFirst = function (predicate) {
    for (let i = 0; i < this.length; i++) {
        if (predicate(this[i])) {
            this.splice(i, 1);
            return true;
        }
    }
    return false;
};

Array.prototype.random = function () {
    const item = this.randomOrUndefined();
    if (!item) {
        throw new Error('Array is empty');
    }
    return item;
};

Array.prototype.randomOrUndefined = function () {
    if (!this.length) return undefined;
    return this[Math.random() * this.length | 0];
};