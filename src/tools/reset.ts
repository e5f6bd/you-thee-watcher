import fs from "fs";
import {Course} from "../itc-lms/types";

(async () => {
    const file = "data-store/itc-lms.json";
    const courses = JSON.parse(await fs.promises.readFile(file, "utf-8")) as Course[];
    for (const course of courses) {
        if (!course.id.startsWith("2021")) continue;
        course.assignments = [];
        course.materials = [];
        course.notifications = [];
    }
    await fs.promises.writeFile(file, JSON.stringify(courses));
})().catch(console.error);