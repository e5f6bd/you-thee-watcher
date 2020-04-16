import puppeteer from 'puppeteer';
import {getAllCourses, getCourse, logInToItcLms} from "./itc-lms/api";
import {promises as fs} from "fs";

const debugMode = !!process.env.YOU_THEE_DEBUG_MODE;

(async () => {
    const browser = await puppeteer.launch({headless: !debugMode});

    const page = (await browser.pages())[0];
    if(!await logInToItcLms(page)) throw new Error("Failed to log in");
    if (process.env.YOU_THEE_DEBUG_COURSE_ID) {
        // single-course debug mode
        console.log(JSON.stringify(await getCourse(browser)(process.env.YOU_THEE_DEBUG_COURSE_ID)))
    } else {
        const courses = await getAllCourses(browser);
        await fs.writeFile("data-store/itc-lms.json", JSON.stringify(courses));
    }

    await page.waitFor(6000000);

    await browser.close();
})().catch(console.error);
