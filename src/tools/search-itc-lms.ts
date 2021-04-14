import fs from "fs";
import readline from "readline";
import {getSearchResult, SearchResult} from "../itc-lms/search";

(async () => {
    const credentials = {
        ing: process.env.YOU_THEE_ITC_LMS_ING!,
        JSESSIONID: process.env.YOU_THEE_ITC_LMS_JSESSION_ID!,
    }
    const csrf = process.env.YOU_THEE_ITC_LMS_SEARCH_CSRF!;

    const [, , file, outputFile] = process.argv;
    if (!file || !outputFile) throw new Error("Specify input and output file.");
    const lines = readline.createInterface({
        input: await fs.createReadStream(file),
        crlfDelay: Infinity,
    });
    const res = new Map<string, SearchResult>();
    for await (const line of lines) {
        console.log(`Searching ${line}`);
        try {
            res.set(line, await getSearchResult(credentials, csrf, line));
        } catch (e) {
            console.error(`Error while processing ${line}`);
            console.error(e);
        }
    }
    console.log(res);
    await fs.promises.writeFile(outputFile, JSON.stringify([...res]));
})().catch(console.error);