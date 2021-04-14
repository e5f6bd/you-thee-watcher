import fs from "fs";
import path from "path";
import {Channel} from "../types/slack";

// From https://github.com/ap2020/snippets/blob/master/utils/utils.ts
// Originally written by pizzacat83
export const z2h = (s: string) =>
    s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

// From https://github.com/ap2020/snippets/blob/master/utils/utils.ts
// Originally written by pizzacat83
export const splitString = (s: string, n: number) => {
    const l = [];
    for (let i = 0; i < s.length; i += 2) {
        l.push(s.slice(i, i + 2));
    }
    return l;
}

// From https://github.com/ap2020/snippets/blob/master/new_semester/course_channels.ts
// Originally written by pizzacat83
const sanitizeChannelName = (name: string): string =>
    name.replace(/[(（)）・]/g, '-')

// From https://github.com/ap2020/snippets/blob/master/new_semester/course_channels.ts
// Originally written by pizzacat83
const getChannelName = (data: Map<string, string>): string => {
    const yougens = splitString(data.get('曜限')!.split(/,\s+/g).join('').replace(/\s/g, ''), 2);
    const yougenMap = new Map<string, string[]>();
    for (const yougen of yougens) {
        const you = yougen[0];
        const gen = yougen[1];
        const youData = yougenMap.get(you) || [];
        youData.push(gen);
        yougenMap.set(you, youData);
    }
    const youList = '月火水木金集'.split('')
        .filter(you => yougenMap.has(you));
    const yougenString = youList
        .map(you => `${you}${yougenMap.get(you)!.sort().join('')}`)
        .join('');
    const name = data.get('開講科目名')!;
    return `1${"月火水木金集".indexOf(youList[0]) + 1}-${yougenString}${sanitizeChannelName(z2h(name))}`.toLowerCase();
}

const getChannelMap = async (dir: string): Promise<Map<string, string>> => {
    const map = new Map();
    for await (const file of await fs.promises.readdir(dir)) {
        const text = await fs.promises.readFile(path.join(dir, file), "utf-8");
        const data = new Map(JSON.parse(text)) as Map<string, string>;
        const channelName = getChannelName(data);
        map.set(channelName, path.basename(file, ".json"));
    }
    return map;
}

const getChannels = async (): Promise<Channel[]> => {
    const channels = JSON.parse(await fs.promises.readFile("ignore/channels.json", "utf-8")) as Channel[];
    return channels
        .filter(channel => !channel.is_archived && (channel.num_members ?? 0) > 1 && channel.name?.startsWith("1"))
        .sort((a, b) => a.name && b.name ? a.name < b.name ? -1 : a.name > b.name ? 1 : 0 : b.name ? -1 : a.name ? 1 : 0);
}

(async () => {
    const [, , syllabusDir] = process.argv;
    const map = await getChannelMap(syllabusDir);
    const channels = await getChannels();
    for (const channel of channels) {
        const name = channel.name;
        if (!name) continue;
        console.log([channel.id, name, map.get(name) ?? name.substr(5)].join("\t"));
    }
})().catch(console.error)
