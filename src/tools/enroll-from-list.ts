import readline from "readline";
import fs from "fs";
import {ItcLmsCredentials} from "../itc-lms/api";
import fetch from "node-fetch";
import {JSDOM} from "jsdom";

interface EnrollmentStatus {
    enrolled: boolean;
    enrollable: boolean;
    enroll_params: { [key: string]: string }
}

const parseEnrollmentStatus = (html: string): EnrollmentStatus => {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    let enrolled, enrollable;
    if (document.querySelector('a[href="#enrollable-popup"]') !== null) {
        enrolled = false;
        enrollable = true;
    } else if (document.querySelector('a[href="#unenrolment-popup"]') !== null) {
        enrolled = enrollable = true;
    } else {
        enrolled = enrollable = false;
    }
    const enroll_form = document.getElementById("enrollParticipantForm")!;
    const enroll_params: { [key: string]: string } = {};
    for (const input of enroll_form.querySelectorAll("input")) {
        enroll_params[input.name] = input.value;
    }
    return {enrolled, enrollable, enroll_params};
}

const checkEnrolled = async (credentials: ItcLmsCredentials, course_id: string): Promise<EnrollmentStatus> => {
    const response = await fetch(`https://itc-lms.ecc.u-tokyo.ac.jp/lms/course?idnumber=${course_id}`, {
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        }
    });
    return parseEnrollmentStatus(await response.text());
};

const enrollClass = async (
    credentials: ItcLmsCredentials, course_id: string, enrollment_info: EnrollmentStatus
): Promise<EnrollmentStatus> => {
    const response = await fetch(`https://itc-lms.ecc.u-tokyo.ac.jp/lms/coursetop/enrollpaticipant`, {
        method: "POST",
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        },
        body: new URLSearchParams(enrollment_info.enroll_params),
    });
    return parseEnrollmentStatus(await response.text());
}

(async () => {
    const credentials = {
        ing: process.env.YOU_THEE_ITC_LMS_ING!,
        JSESSIONID: process.env.YOU_THEE_ITC_LMS_JSESSION_ID!,
    }

    const [, , file] = process.argv;
    if (!file) throw new Error("Specify input file.");
    const lines = readline.createInterface({
        input: await fs.createReadStream(file),
        crlfDelay: Infinity,
    });

    for await (const course_id of lines) {
        if (course_id) {
            const status = await checkEnrolled(credentials, course_id);
            if (status.enrolled) {
                console.log(`Already enrolled in ${course_id}`);
            } else if (status.enrollable) {
                console.log(`Trying to enroll in ${course_id}`);
                const result = await enrollClass(credentials, course_id, status);
                if (result.enrolled) {
                    console.log("Successfully enrolled.");
                } else {
                    console.log("Failed to enroll.");
                }
            } else {
                console.log(`Skipping: cannot enroll in ${course_id}`);
            }
            break;
        }
    }
})().catch(console.error);
