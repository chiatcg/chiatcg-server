declare interface Array<T> {
    findAndRemoveFirst(predicate: (item: T) => boolean): boolean;
    random(): T;
    randomOrUndefined(): T | undefined;
    removeFirst(item: T): boolean;
}