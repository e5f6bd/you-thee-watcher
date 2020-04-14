import * as querystring from "querystring";
import {Page} from "puppeteer";
import {Course, Notification, Period} from "./types";
import dayjs, {Dayjs} from "dayjs";

// http://ecma-international.org/ecma-262/5.1/#sec-15.9.1.1
// The first and the last moment that can be handled with JavaScript.
const periodFallback: Period = {
    start: dayjs(-8.64e15),
    end: dayjs(8.64e15),
}
const strToPeriod = (str: string): Period => {
    const split = str.split(" ～ ");
    if (split.length < 2) return periodFallback;
    return {
        start: dayjs(split[0]),
        end: dayjs(split[1]),
    };
}

export const getCourse = async (page: Page, courseId: string): Promise<Course> => {
    await page.goto(
        "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course?" + querystring.encode({idnumber: courseId}),
        {"waitUntil": "networkidle0"});
    console.log("Success");
    const notifications = await Promise.all(
        (await page.$$("div#information div.subblock_list_line"))
            .map(async element => {
                const titleElement = await element.$("div.subblock_list_txt1");
                const titleHandle = await titleElement!.getProperty("textContent");
                const title = await titleHandle!.jsonValue() as string || "";

                const periodElement = await element.$("div.subblock_list_txt2");
                const periodHandle = await periodElement!.getProperty("textContent");
                const periodStr = await periodHandle!.jsonValue() as string || "";

                const ret: Notification =  {
                    title,
                    contents: "",
                    postingPeriod: strToPeriod(periodStr),
                };
                return ret;
            }));
    return {
        notifications,
        assignments: [],
        materials: [],
    };
}
