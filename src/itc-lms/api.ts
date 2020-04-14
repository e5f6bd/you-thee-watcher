import * as querystring from "querystring";
import {Page} from "puppeteer";
import {Course, Notification, Period} from "./types";
import dayjs from "dayjs";

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
    const notifications: Notification[] = [];
    for (const element of await page.$$("div#information div.subblock_list_line")) {
        const titleElement = await element.$("div.subblock_list_txt1");
        if (titleElement === null) throw new Error("No title block found");
        const titleHandle = await titleElement.getProperty("textContent");
        const title = await titleHandle.jsonValue() as string || "";

        const periodElement = await element.$("div.subblock_list_txt2");
        if (periodElement === null) throw new Error("No period block found");
        const periodHandle = await periodElement!.getProperty("textContent");
        const periodStr = await periodHandle!.jsonValue() as string || "";

        // Open notification by clicking the link
        const clickElement = await titleElement.$("a");
        if (clickElement === null) throw new Error("No element to click was found");
        await clickElement.click();

        // Wait until the notification contents are loaded
        // (This is judged by the completion of the request below)
        await page.waitForResponse(response =>
            response.url().indexOf("https://itc-lms.ecc.u-tokyo.ac.jp/lms/coursetop/information/listdetail") !== -1);
        // Wait for additional time just in case (because the DOM may not be ready immediately)
        await page.waitFor(100);

        // Get the dialog
        const dialog = await page.$("div[role=dialog]");
        if (dialog === null) throw new Error("Dialog not found...");

        // get the contents
        const contentsElement = await dialog.$("div.textareaContents");
        if(contentsElement === null) throw new Error("Contents Element not found...");
        const contentsHandle = await contentsElement.getProperty("innerText"); // <- is innerText the best way?
        const contents = await contentsHandle.jsonValue() as string;

        // close the dialog
        const closeElement = await dialog.$("div.ui-dialog-buttonpane button");
        await closeElement!.click();
        await page.waitFor(500);

        notifications.push({
            title,
            contents,
            postingPeriod: strToPeriod(periodStr),
        });
    }
    return {
        notifications,
        assignments: [],
        materials: [],
    };
}
