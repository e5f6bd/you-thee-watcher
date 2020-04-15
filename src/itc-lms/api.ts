import * as querystring from "querystring";
import {ElementHandle, Page} from "puppeteer";
import {Assignment, AssignmentSubmissionMethod, AttachmentFile, Course, Notification, Period} from "./types";
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
const getStringProperty = async (element: ElementHandle, propertyName: string): Promise<string> => {
    const property = await element.getProperty(propertyName);
    return await property.jsonValue() as string;
};
const resolveURL = async (page: Page, relativeUrl: string): Promise<string> => {
    return new URL(relativeUrl, await page.evaluate(async () => document.baseURI)).href;
}

const parseRichText = async (element: ElementHandle): Promise<string> => {
    // TODO parse rich text style such as bold, italic, underline, hyperlink, tex equation, and so on.
    // TODO Is innerText the best way?
    return await getStringProperty(element, "innerText") || "";
}
const parseAttachmentDiv = async (element: ElementHandle): Promise<AttachmentFile> => {
    const [title, filename, objectName] =
        await Promise.all(["downloadFile", "fileName", "objectName"].map(async className =>
            await getStringProperty(
                (await element.$(`div.${className}`))!, "innerText")));
    return {title, filename, objectName}
}

export const getCourse = async (page: Page, courseId: string): Promise<Course> => {
    await page.goto(
        "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course?" + querystring.encode({idnumber: courseId}),
        {"waitUntil": "networkidle0"});
    const notifications: Notification[] = [];
    for (const element of await page.$$("div#information div.subblock_list_line")) {
        const titleElement = (await element.$("div.subblock_list_txt1"))!;
        const title = await getStringProperty(titleElement, "textContent") || "";

        const periodStr = await getStringProperty(
            (await element.$("div.subblock_list_txt2"))!, "textContent");

        // Open notification by clicking the link
        const clickElement = (await titleElement.$("a"))!;
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
        const contents = await parseRichText((await dialog.$("div.textareaContents"))!);

        // close the dialog
        const closeElement = (await dialog.$("div.ui-dialog-buttonpane button"))!;
        await closeElement.click();
        await page.waitFor(500);

        notifications.push({
            title,
            contents,
            postingPeriod: strToPeriod(periodStr),
        });
    }
    const assignments: Assignment[] = [];
    for (const element of await page.$$("div#report div.report_list_line")) {
        const entryLinkDiv = (await element.$("div.result_list_txt"))!;  // there are five columns, get the first
        const url = await getStringProperty((await entryLinkDiv.$x("./a/@href"))[0], "value");
        const newPage = await page.browser().newPage();
        await newPage.goto(await resolveURL(page, url), {"waitUntil": "networkidle0"});

        const [titleDiv, contentsDiv, attachmentsDiv, submissionPeriodDiv, lateSubmissionDiv] =
            await newPage.$$("div.page_supple div.subblock_form");

        const title = await getStringProperty(titleDiv, "innerText");
        const contents = await parseRichText((await contentsDiv.$("div.textareaContents"))!);
        const attachmentFiles = await Promise.all(
            (await attachmentsDiv.$x("./div")).map(parseAttachmentDiv));
        const submissionPeriod = strToPeriod(
            await getStringProperty(submissionPeriodDiv, "innerText"))
        const lateSubmissionAllowed = "Enable" ===
            await getStringProperty(lateSubmissionDiv, "innerText");

        assignments.push({
            title, attachmentFiles, contents, submissionPeriod, lateSubmissionAllowed,
            submissionMethod: AssignmentSubmissionMethod.UploadFile,  // TODO parse it
        })

        await newPage.close();
    }
    return {
        notifications,
        assignments,
        materials: [],
    };
}
