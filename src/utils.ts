export const distinct = <T>(items: Iterable<T>): Array<T> => {
    return Array.from(new Set(items));
};

export const sleep = async (millis: number) => await new Promise(resolve => setTimeout(resolve, millis));

export const sameSet = <T, U>(lhs: Iterable<T>, rhs: Iterable<T>): boolean => {
    const set = new Set(lhs);
    return Array.from(rhs).every(i => set.has(i));
}

