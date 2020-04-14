import puppeteer, {Page} from 'puppeteer';

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
    console.log(await logInToItcLms(page));
    await page.waitFor(30000);
    await browser.close();
})().catch(console.error);
