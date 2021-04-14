import {ItcLmsCredentials} from "./api";
import fetch from "node-fetch";
import {JSDOM} from "jsdom";

export interface SearchResult {
    courses: SearchCourse[];
    begin: number;
    end: number;
    total: number;
}

export interface SearchCourse {
    lms_course_id: string;
    course_title: string;
    instructors: string;  // [string] ?
    classification: string;
    days_and_periods: string;  // [string] ?
    syllabus_url: string;
}

const parseCourseRowElement = async (row: Element): Promise<SearchCourse> => {
    const first = <HTMLElement>row.querySelector(".result_list_txt1 a")!;
    const lms_course_id = first.id;
    const course_title = first.textContent!;
    const instructors = row.querySelector(".result_list_txt2")!.textContent!;
    const classification = row.querySelector(".result_list_txt3")!.textContent!;
    const days_and_periods = row.querySelector(".result_list_txt4")!.textContent!;
    const syllabus_url = (<HTMLLinkElement>row.querySelector(".result_list_txt6 a")!).href;
    return {
        lms_course_id, course_title, instructors,
        classification, days_and_periods, syllabus_url,
    };
}

export const getSearchResult = async (credentials: ItcLmsCredentials, csrf: string, keyword: string): Promise<SearchResult> => {
    const response = await fetch("https://itc-lms.ecc.u-tokyo.ac.jp/course/search", {
        method: "POST",
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        },
        body: new URLSearchParams({
            _csrf: csrf,
            freeWord: keyword,
            nendo: "2021",
            yobiType: "",
            jigenCd: "",
            termType: "noneselect",
            term: "2021,0A,S1,2021/04/01,2021/06/03",
            section: "2021,01,夏学期",
            defaultTerm: "2021,S1",
            searchFlag: "検索",
            courseType: "0",
        }),
    });
    const dom = new JSDOM(await response.text());
    const document = dom.window.document;
    const courses = await Promise.all([...document.querySelectorAll(".result_list_line")]
        .map(parseCourseRowElement));
    const pagingTxt = document.querySelector(".result_paging_txt");
    const [, total, begin, end] = pagingTxt ?
        /([0-9,]+)件中([0-9,]+)〜([0-9,]+)件を表示/.exec(pagingTxt.textContent!)! :
        [0, "0", "0", "0"];
    return {
        courses,
        begin: parseInt(begin.replace(",", "")),
        end: parseInt(end.replace(",", "")),
        total: parseInt(total.replace(",", "")),
    };
}

