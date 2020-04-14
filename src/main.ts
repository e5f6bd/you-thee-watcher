import puppeteer, {Page} from 'puppeteer';

const debugMode = !!process.env.YOU_THEE_DEBUG_MODE;

const logInToItcLms = async (page: Page) => {
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
}

(async () => {
    const browser = await puppeteer.launch({headless: !debugMode});
    const page = await browser.newPage();
    await logInToItcLms(page);
    await page.goto('https://itc-lms.ecc.u-tokyo.ac.jp');
    await page.waitFor(30000);
    await browser.close();
})().catch(console.error);
