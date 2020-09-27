import {promises as fsPromises} from "fs";
import {SearchResult} from "../itc-lms/search";

(async () => {
    const json: [string, SearchResult][] = JSON.parse(await fsPromises.readFile("ignore/list.json", "utf-8"));
    const res = [];
    for (const [code, {courses}] of json) {
        if(courses.length === 0) {
            console.error(`${code}`);
        } else {
            const ids = courses.map(e => e.lms_course_id);
            if(ids.every(id => id === ids[0])) {
                res.push([code, ids[0]]);
            } else {
                console.error(`${code}`);
            }
        }
    }
    console.log(res.map(([a, b]) => `${a}\t${b}`).join("\n"));
})().catch(console.error);