declare interface Array<T> {
    findAndRemoveFirst(predicate: (item: T) => boolean): boolean;
    random(): T;
    randomOrUndefined(): T | undefined;
    removeFirst(item: T): boolean;
    filter(booleanCtor: typeof Boolean): NonNullableVoid<T>[];
}

declare type NonNullableVoid<T> = Exclude<NonNullable<T>, void>;
declare type StringsStartingWith<T extends string, K extends string> = T extends `${K}${infer _X}` ? T : never;
declare type KeyOfFilteredByValueType<T, F> = NonNullable<{ [K in keyof T]: T[K] extends F ? K : never }[keyof T]>;
declare type TypeConstructor<T> = { new(...args: any[]): T };