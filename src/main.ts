import puppeteer, {Page} from 'puppeteer';
import {getCourse} from "./itc-lms/api";

const debugMode = !!process.env.YOU_THEE_DEBUG_MODE;

const logInToItcLms = async (page: Page): Promise<boolean> => {
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
    await page.goto('https://itc-lms.ecc.u-tokyo.ac.jp', {
        "waitUntil": "networkidle0"
    });
    const url = page.url();
    switch (url) {
        case "https://itc-lms.ecc.u-tokyo.ac.jp/lms/timetable":
            return true;
        case "https://itc-lms.ecc.u-tokyo.ac.jp/login":
            return false;
        default:
            throw new Error(`Unexpected URL: ${url}`);
    }
}

(async () => {
    const browser = await puppeteer.launch({headless: !debugMode});
    const page = await browser.newPage();
    if(!await logInToItcLms(page)){
        console.error("Failed to log in.")
        await page.waitFor(60000);
        throw new Error();
    }
    await page.waitFor(1000);

    const course = await getCourse(page, process.env.YOU_THEE_DEBUG_COURSE_ID || "");
    console.log(course);
    await page.waitFor(60000);

    await browser.close();
})().catch(console.error);
