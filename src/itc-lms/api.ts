import querystring from "querystring";
import {Browser, Cookie, ElementHandle, Page} from "puppeteer";
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
import customParseFormat from 'dayjs/plugin/customParseFormat'
import {distinct} from "../utils";
import {getInnerText, getStringProperty, getValue} from "../puppeteer-utils";
import {promisify} from "util";
import Read from "read";

dayjs.extend(customParseFormat)
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
        start: dayjs(split[0] + " +09:00", "YYYY/MM/DD HH:mm Z"),
        end: dayjs(split[1] + " +09:00", "YYYY/MM/DD HH:mm Z"),
    };
}

const getURLObject = async (page: Page, relativeUrl: string): Promise<URL> => {
    return new URL(relativeUrl, await page.evaluate(async () => document.baseURI));
}

const parseRichText = async (element: ElementHandle): Promise<string> => {
    // TODO parse rich text style such as bold, italic, underline, hyperlink, tex equation, and so on.
    // TODO Is innerText the best way?
    return await getInnerText(element) || "";
}
const parseAttachmentDiv = (fileNameClassName: string) => async (element: ElementHandle): Promise<AttachmentFile> => {
    const [title, filename, objectName] =
        await Promise.all([fileNameClassName, "fileName", "objectName"].map(async className =>
            await getInnerText((await element.$(`.${className}`))!)));
    return {type: "File", id: objectName, title, filename}
}

const parseNotification = (page: Page) => async (element: ElementHandle): Promise<Notification> => {
    const titleElement = (await element.$("div.subblock_list_txt1"))!;
    const title = await getInnerText(titleElement) || "";

    const periodStr = await getInnerText((await element.$("div.subblock_list_txt2"))!);

    const linkElement = (await titleElement.$("a"))!;
    const onclickValue = await getValue((await linkElement.$x("@onclick"))[0]);
    const id = onclickValue.match(/InfoDetailCourseTop\(event,(\d+)\);/)![1];

    // Open notification by clicking the link
    await linkElement.click();

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
        id, title, contents,
        postingPeriod: strToPeriod(periodStr),
    };
}

const parseAssignment = (page: Page) => async (element: ElementHandle): Promise<Assignment> => {
    const entryLinkDiv = (await element.$("div.result_list_txt"))!;  // there are five columns, get the first
    const href = await getValue((await entryLinkDiv.$x("./a/@href"))[0]);
    const newPage = await page.browser().newPage();
    const url = await getURLObject(page, href);
    const id = url.searchParams.get('reportId')!;
    await newPage.goto(url.href, {"waitUntil": "networkidle0"});

    const [titleDiv, contentsDiv, attachmentsDiv, submissionPeriodDiv, lateSubmissionDiv] =
        await newPage.$$("div.page_supple div.subblock_form");

    const title = await getInnerText(titleDiv);
    const contents = await parseRichText((await contentsDiv.$("div.textareaContents"))!);
    const attachmentFiles = await Promise.all(
        (await attachmentsDiv.$x("./div")).map(parseAttachmentDiv("downloadFile")));
    const submissionPeriod = strToPeriod(
        await getInnerText(submissionPeriodDiv))
    const lateSubmissionAllowed = "Enable" ===
        await getInnerText(lateSubmissionDiv);

    await newPage.close();

    return {
        id, title, attachmentFiles, contents, submissionPeriod, lateSubmissionAllowed,
        submissionMethod: AssignmentSubmissionMethod.UploadFile,  // TODO parse it
    };
}

const parseMaterial = async (
    titleDiv: ElementHandle,
    publicationPeriodDiv: ElementHandle,
    commentDiv: ElementHandle,
    itemDivs: ElementHandle[]
): Promise<Material> => {
    const title = await getInnerText(titleDiv);
    const publicationPeriod = await strToPeriod(await getInnerText(publicationPeriodDiv));
    const contents = await parseRichText(commentDiv);
    const items: MaterialItem[] = [];
    let materialId = "";  // Only set when there are any items

    for (const itemDiv of itemDivs) {
        const itemId = await getStringProperty("id")(itemDiv);

        const [fileDiv, commentDiv, dateDiv] = await itemDiv.$$("div.result_list_txt");
        const itemTitle = await getInnerText(fileDiv);
        const comments = await getInnerText(commentDiv);
        const createDate = dayjs(
            await getInnerText(dateDiv) + " +09:00", "YYYY/MM/DD Z");

        let contents: MaterialItemContents;
        const linkElement = await fileDiv.$("a");
        const videoElement = await fileDiv.$("video");
        if (linkElement) {
            contents = {
                type: "Link",
                url: await getValue((await linkElement.$x("@href"))[0])
            };
        } else if (videoElement) {
            contents = {
                type: "Video",
                url: await getValue((await videoElement.$x(".//source/@src"))[0])
            };
        } else {
            contents = await parseAttachmentDiv("fileDownload")(fileDiv);
        }

        items.push({
            id: itemId, title: itemTitle,
            comments, contents, createDate
        });

        if (!materialId) {
            materialId = await getValue((await fileDiv.$("#dlMaterialId"))!);
        }
    }

    return {
        id: materialId,
        title, publicationPeriod, contents, items,
    }
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

export const getCourse = (browser: Browser) => async (courseId: string): Promise<Course> => {
    // console.log(`Obtaining information for ${courseId}`);

    const page = await browser.newPage();
    await page.waitFor(500);
    await page.goto(
        "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course?" + querystring.encode({
            idnumber: courseId,
            selectDisplayView: "ASSISTANT_ADD",
        }),
        {"waitUntil": "networkidle0"});
    if (!checkLogIn(page)) throw new Error("Not logged in.");

    const name = await getInnerText((await page.$("#courseName div.page_name_txt"))!);

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
    await page.close();

    return {
        id: courseId, name,
        notifications, assignments, materials
    };
}

/**
 * Access to top page and check if it is navigated to timetable page.
 * If successful, the location of the page is at the timetable page in the end.
 *
 * @param page
 */
export const logInToItcLms = async (page: Page): Promise<boolean> => {
    await page.setCookie({
        name: "JSESSIONID",
        value: process.env.YOU_THEE_ITC_LMS_JSESSION_ID || "",
        domain: "itc-lms.ecc.u-tokyo.ac.jp",
        path: "/",
        httpOnly: true,
        secure: true,
    }, {
        name: "ing",
        value: process.env.YOU_THEE_ITC_LMS_ING || "",
        domain: ".itc-lms.ecc.u-tokyo.ac.jp",
        path: "/",
        httpOnly: true,
    });
    await page.goto('https://itc-lms.ecc.u-tokyo.ac.jp', {waitUntil: "networkidle0"});
    if (page.url() === "https://itc-lms.ecc.u-tokyo.ac.jp/login") {
        console.log("Cookies are not provided, or the cookies are invalid.");
        await page.goto((await getURLObject(page, "/saml/login?disco=true")).href, {
            waitUntil: "networkidle0"
        });
        if (!process.env.YOU_THEE_ACCOUNT) throw new Error("Failed automatic login: account not set.");
        await page.type('#userNameInput', process.env.YOU_THEE_ACCOUNT!);
        const password = process.env.YOU_THEE_PASSWORD || await promisify(Read)({
            prompt: "Enter password within a minute:",
            silent: true,
            timeout: 60 * 1000,
        });
        await page.type('#passwordInput', password);
        await Promise.all([
            page.waitForFunction("document.location.host.indexOf('itc-lms') !== -1"),
            page.click('#submitButton'),
        ]);
    }
    if (!checkLogIn(page)) return false;
    const url = page.url();
    switch (url) {
        case "https://itc-lms.ecc.u-tokyo.ac.jp/lms/timetable":
            return true;
        default:
            throw new Error(`Unexpected URL: ${url}`);
    }
}

const checkLogIn = (page: Page): boolean => {
    return page.url() !== "https://itc-lms.ecc.u-tokyo.ac.jp/login";
}

export const getAllCourses = async (browser: Browser): Promise<Course[]> => {
    const page = (await browser.pages())[0];
    await page.goto("https://itc-lms.ecc.u-tokyo.ac.jp/lms/timetable?selectToday=true",
        {waitUntil: "networkidle0"});
    let courseIds =
        distinct(await page.$$("div.course_on_timetable")
            .then(es => Promise.all(es.map(getStringProperty("id")))));
    if (process.env.YOU_THEE_DEBUG_COURSE_IDS) {
        const limitedCourseIds = new Set(process.env.YOU_THEE_DEBUG_COURSE_IDS.split(","));
        courseIds = courseIds.filter(x => limitedCourseIds.has(x));
    }
    const courses = [];
    for (const courseId of courseIds) {
        courses.push(await getCourse(browser)(courseId));
    }
    return courses;
}

export const getAttachmentFileDownloadUrl = (file: AttachmentFile): string => {
    return "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course/report/submission_download/" +
        encodeURIComponent(file.filename) + "?" + querystring.encode({
            // idnumber: 2020FEN-CO3125L10F01
            downloadFileName: file.filename,
            objectName: file.id,
            // downloadMode:
        });
};

export interface ItcLmsCredentials {
    ing: string;
    JSESSIONID: string;
}

export const getCredentialsFromCookies = (cookies: Cookie[]): ItcLmsCredentials => {
    const ing = cookies.filter(cookie => cookie.domain === '.itc-lms.ecc.u-tokyo.ac.jp' && cookie.name === 'ing')[0];
    const JSESSIONID = cookies.filter(cookie => cookie.domain === "itc-lms.ecc.u-tokyo.ac.jp" && cookie.name == 'JSESSIONID')[0];
    if (!ing || !JSESSIONID) throw new Error("Could not obtain credentials cookie from the browser");
    return {ing: ing.value, JSESSIONID: JSESSIONID.value};
}