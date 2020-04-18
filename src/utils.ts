import readline from "readline";

export const distinct = <T>(items: Iterable<T>): Array<T> => {
    return Array.from(new Set(items));
};

export const sleep = async (millis: number) => await new Promise(resolve => setTimeout(resolve, millis));

export const sameSet = <T, U>(lhs: Iterable<T>, rhs: Iterable<T>): boolean => {
    const set = new Set(lhs);
    return Array.from(rhs).every(i => set.has(i));
}

export const createIdMap = <T extends { id: string }>(items: T[]): Map<string, T> =>
    new Map(items.map(item => [item.id, item]));

export const askQuestionViaStdin = (query: string): Promise<string> => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
};