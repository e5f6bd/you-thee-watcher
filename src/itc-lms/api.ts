import * as querystring from "querystring";
import {ElementHandle, Page} from "puppeteer";
import {
    Assignment,
    AssignmentSubmissionMethod,
    AttachmentFile,
    Course,
    Material,
    MaterialItem,
    MaterialItemContents,
    Notification,
    Period
} from "./types";
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
const parseAttachmentDiv = (fileNameClassName: string) => async (element: ElementHandle): Promise<AttachmentFile> => {
    const [title, filename, objectName] =
        await Promise.all([fileNameClassName, "fileName", "objectName"].map(async className =>
            await getStringProperty(
                (await element.$(`.${className}`))!, "innerText")));
    return {title, filename, objectName}
}

const parseNotification = (page: Page) => async (element: ElementHandle): Promise<Notification> => {
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

    return {
        title,
        contents,
        postingPeriod: strToPeriod(periodStr),
    };
}

const parseAssignment = (page: Page) => async (element: ElementHandle): Promise<Assignment> => {
    const entryLinkDiv = (await element.$("div.result_list_txt"))!;  // there are five columns, get the first
    const url = await getStringProperty((await entryLinkDiv.$x("./a/@href"))[0], "value");
    const newPage = await page.browser().newPage();
    await newPage.goto(await resolveURL(page, url), {"waitUntil": "networkidle0"});

    const [titleDiv, contentsDiv, attachmentsDiv, submissionPeriodDiv, lateSubmissionDiv] =
        await newPage.$$("div.page_supple div.subblock_form");

    const title = await getStringProperty(titleDiv, "innerText");
    const contents = await parseRichText((await contentsDiv.$("div.textareaContents"))!);
    const attachmentFiles = await Promise.all(
        (await attachmentsDiv.$x("./div")).map(parseAttachmentDiv("downloadFile")));
    const submissionPeriod = strToPeriod(
        await getStringProperty(submissionPeriodDiv, "innerText"))
    const lateSubmissionAllowed = "Enable" ===
        await getStringProperty(lateSubmissionDiv, "innerText");

    await newPage.close();

    return {
        title, attachmentFiles, contents, submissionPeriod, lateSubmissionAllowed,
        submissionMethod: AssignmentSubmissionMethod.UploadFile,  // TODO parse it
    };
}

const parseMaterial = async (
    titleDiv: ElementHandle,
    publicationPeriodDiv: ElementHandle,
    commentDiv: ElementHandle,
    itemDivs: ElementHandle[]
): Promise<Material> => {
    const title = await getStringProperty(titleDiv, "innerText");
    const publicationPeriod = await strToPeriod(await getStringProperty(publicationPeriodDiv, "innerText"));
    const contents = await parseRichText(commentDiv);
    const items: MaterialItem[] = [];
    for (const itemDiv of itemDivs) {
        const [fileDiv, commentDiv, dateDiv] = await itemDiv.$$("div.result_list_txt");
        const itemTitle = await getStringProperty(fileDiv, "innerText");
        const comments = await getStringProperty(commentDiv, "innerText");
        const createDate = dayjs(await getStringProperty(dateDiv, "innerText"));

        let contents: MaterialItemContents;
        const linkElement = await fileDiv.$("a");
        const videoElement = await fileDiv.$("video");
        if (linkElement) {
            contents = {
                type: "Link",
                url: await getStringProperty((await linkElement.$x("@href"))[0], "value")
            };
        } else if (videoElement) {
            contents = {
                type: "Video",
                url: await getStringProperty(
                    (await videoElement.$x(".//source/@src"))[0], "value")
            };
        } else {
            contents = await parseAttachmentDiv("fileDownload")(fileDiv);
        }

        items.push({
            title: itemTitle, comments, contents, createDate
        })
    }

    return {title, publicationPeriod, contents, items}
};

const parseMaterials = async (page: Page) => {
    // An entry of material consists of its title, publication period, comment,
    // table header and rows, in this order, each of which forms a child block in the materialList.
    // To make implementation simpler, the blocks are iterated in the reversed order.
    // Once it founds a title block, the block components collected so far are
    // parsed into a material entry.

    type ElementHandleOpt = ElementHandle | null;
    let publicationPeriodDiv: ElementHandleOpt = null,
        commentDiv: ElementHandleOpt = null,
        materialItemDivs: ElementHandle[] = [];

    const materials: Material[] = []

    for (const block of (await page.$x(`id("materialList")/div`)).reverse()) {
        const classes = new Set(Object.values(
            await block.getProperty("classList").then(e => e.jsonValue()) as { [key: string]: string }));
        if (classes.has('subblock_list_head')) {
            materials.push(await parseMaterial(block, publicationPeriodDiv!, commentDiv!, materialItemDivs.reverse()));
            publicationPeriodDiv = null;
            commentDiv = null;
            materialItemDivs = [];
        } else if (classes.has('subblock_line')) {
            publicationPeriodDiv = block;
        } else if (classes.has('subblock_list_comment')) {
            commentDiv = block;
        } else if (classes.has('result_list_line')) {
            materialItemDivs.push(block);
        }
    }

    return materials;
};

export const getCourse = async (page: Page, courseId: string): Promise<Course> => {
    await page.goto(
        "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course?" + querystring.encode({
            idnumber: courseId,
            selectDisplayView: "ASSISTANT_ADD",
        }),
        {"waitUntil": "networkidle0"});

    const notifications = [];
    // Promise.all cannot be used here because each notification window has to be opened separately
    for (const element of await page.$$("div#information div.subblock_list_line")) {
        notifications.push(await parseNotification(page)(element));
    }

    const assignments = [];
    // This may be replaced with Promise.all, but for now it's left unchanged for the sake of consistency
    for (const element of await page.$$("div#report div.report_list_line")) {
        assignments.push(await parseAssignment(page)(element))
    }

    const materials = await parseMaterials(page);

    return {notifications, assignments, materials};
}
