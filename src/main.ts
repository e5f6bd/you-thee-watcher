import puppeteer, {Cookie} from 'puppeteer';
import {getAllCourses, getCourse, logInToItcLms} from "./itc-lms/api";
import * as fs from "fs";
import {Assignment, AttachmentFile, Course, Material, Notification} from "./itc-lms/types";
import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {distinct, sameSet, sleep} from "./utils";
import {materialItemIsFile, samePeriod} from "./itc-lms/utils";
import * as querystring from "querystring";
import fetch from 'node-fetch';
import {createDriveClient, createFolderAndGetId} from "./drive";
import {drive_v3} from "googleapis";
import Schema$File = drive_v3.Schema$File;

const debugMode = !!process.env.YOU_THEE_DEBUG_MODE;

const createIdMap = <T extends { id: string }>(items: T[]): Map<string, T> =>
    new Map(items.map(item => [item.id, item]));

const getSlackChannel = (courseId: string): string => {
    return process.env.YOU_THEE_SLACK_CHANNEL_ID!;
}

type PostDraft = Omit<ChatPostMessageArguments, "channel">;

const createNotificationPost = (oldOne?: Notification, newOne?: Notification): PostDraft[] => {
    if (oldOne && newOne) {
        if (oldOne.title !== newOne.title ||
            oldOne.contents !== newOne.contents ||
            !samePeriod(oldOne.postingPeriod, newOne.postingPeriod)
        ) {
            return [{
                text: `お知らせ「${newOne.title}」の内容が変更されました。`
            }];
        }
    } else if (oldOne) {
        return [{
            text: `お知らせ「${oldOne.title}」が削除されました。`
        }];
    } else if (newOne) {
        return [{
            text: `お知らせ「${newOne.title}」が追加されました。`
        }];
    }
    return [];
}

const createAssignmentPost = (oldOne?: Assignment, newOne?: Assignment): PostDraft[] => {
    if (oldOne && newOne) {
        if (oldOne.title !== newOne.title ||
            oldOne.contents !== newOne.contents ||
            !sameSet(oldOne.attachmentFiles.map(x => x.id), newOne.attachmentFiles.map(x => x.id)) ||
            !samePeriod(oldOne.submissionPeriod, newOne.submissionPeriod) ||
            oldOne.submissionMethod !== newOne.submissionMethod ||
            oldOne.lateSubmissionAllowed !== newOne.lateSubmissionAllowed
        ) {
            return [{
                text: `課題「${newOne.title}」の内容が変更されました。`
            }];
        }
    } else if (oldOne) {
        return [{
            text: `課題「${oldOne.title}」が削除されました。`
        }];
    } else if (newOne) {
        return [{
            text: `課題「${newOne.title}」が追加されました。`
        }]
    }
    return [];
}

const createMaterialPost = (oldOne?: Material, newOne?: Material): PostDraft[] => {
    if (oldOne && newOne) {
        if (oldOne.title !== newOne.title ||
            oldOne.contents !== newOne.contents ||
            !sameSet(oldOne.items.map(x => x.id), newOne.items.map(x => x.id)) ||
            !samePeriod(oldOne.publicationPeriod, newOne.publicationPeriod)
        ) {
            return [{
                text: `教材「${newOne.title}」の内容が変更されました。`
            }];
        }
    } else if (oldOne) {
        return [{
            text: `教材「${oldOne.title}」が削除されました。`
        }];
    } else if (newOne) {
        return [{
            text: `教材「${newOne.title}」が追加されました。`
        }]
    }
    return [];
}

const processCourseDiff = (oldCourse: Course, newCourse: Course): PostDraft[] => {
    const posts: PostDraft[] = [];
    const processDifferences = <T extends { id: string }>(
        olds: T[], news: T[], composer: (a: T | undefined, b: T | undefined) => PostDraft[]) => {
        const oldMap = createIdMap(olds);
        const newMap = createIdMap(news);
        for (const id of distinct([...oldMap.keys(), ...newMap.keys()])) {
            posts.push(...composer(oldMap.get(id), newMap.get(id)));
        }
    }
    processDifferences(oldCourse.notifications, newCourse.notifications, createNotificationPost);
    processDifferences(oldCourse.assignments, newCourse.assignments, createAssignmentPost);
    processDifferences(oldCourse.materials, newCourse.materials, createMaterialPost);
    return posts;
};

const getDownloadUrl = (file: AttachmentFile): string => {
    return "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course/report/submission_download/" +
        encodeURIComponent(file.filename) + "?" + querystring.encode({
            // idnumber: 2020FEN-CO3125L10F01
            downloadFileName: file.filename,
            objectName: file.id,
            // downloadMode:
        });
};

const collectAllAttachmentFiles = (course: Course): AttachmentFile[] => {
    return new Array<AttachmentFile>().concat(
        course.assignments.flatMap(a => a.attachmentFiles),
        course.materials.flatMap(m => m.items).flatMap(i => i.contents).filter(materialItemIsFile),
    );
}

interface ItcLmsCredentials {
    ing: string;
    JSESSIONID: string;
}

const getCredentialsFromCookies = (cookies: Cookie[]): ItcLmsCredentials => {
    const ing = cookies.filter(cookie => cookie.domain === '.itc-lms.ecc.u-tokyo.ac.jp' && cookie.name === 'ing')[0];
    const JSESSIONID = cookies.filter(cookie => cookie.domain === "itc-lms.ecc.u-tokyo.ac.jp" && cookie.name == 'JSESSIONID')[0];
    if (!ing || !JSESSIONID) throw new Error("Could not obtain credentials cookie from the browser");
    return {ing: ing.value, JSESSIONID: JSESSIONID.value};
}

interface CourseFolderMapping {
    id: string;  // course id
    rootFolderId: string;
    assignmentsRootFolderId?: string;
    assignmentsMappings: IdFolderMapping[];
    materialsRootFolderId?: string;
    materialsMappings: IdFolderMapping[];
}

interface IdFolderMapping {
    id: string;
    folderId: string;
}

const saveFileToDriveIfNeeded = async (
    credentials: ItcLmsCredentials,
    drive: drive_v3.Drive,
    driveIdMap: Map<string, string>,
    file: AttachmentFile
): Promise<string | undefined> => {
    if (driveIdMap.has(file.id)) return;
    console.log(`Saving ${file.id}`);
    const response = await fetch(getDownloadUrl(file), {
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        }
    });
    if (!response.ok) {
        console.error(`Failed to download ${file.id}`);
        return;
    }
    return await drive.files.create({
        requestBody: {
            name: file.filename,
            parents: [process.env.YOU_THEE_DRIVE_MASTER_FOLDER_ID!],
        },
        media: {
            mimeType: "application/octet-stream",
            body: response.body,
        },
        fields: "id",
    }).then(({data: driveFile}: { data: Schema$File }) => {
        driveIdMap.set(file.id, driveFile.id!);
        return driveFile.id!;
    }).catch(async reason => {
        console.error("Failed to upload file", reason)
        return undefined;
    });
};

const updateDrive = async (courses: Course[], credentials: ItcLmsCredentials) => {
    const masterJsonPath = "data-store/itc-lms-drive-master.json";
    const driveIdMap = await fs.promises.readFile(masterJsonPath, "utf-8")
        .then(str => new Map(Object.entries(JSON.parse(str))))
        .catch(() => new Map()) as Map<string, string>;

    const mappingJsonPath = "data-store/itc-lms-drive-mapping.json";
    const mappings = await fs.promises.readFile(mappingJsonPath, "utf-8")
        .then(str => createIdMap<CourseFolderMapping>(JSON.parse(str)))
        .catch(() => new Map<string, CourseFolderMapping>());

    const drive = await createDriveClient();

    // Create folder if needed
    for (const course of courses.values()) {
        if (!mappings.has(course.id)) {
            const name = course.name;
            await createFolderAndGetId(
                drive, name, process.env.YOU_THEE_DRIVE_SHARED_FOLDER_ID!
            ).then(async rootFolderId => {
                mappings.set(course.id, {
                    id: course.id,
                    rootFolderId,
                    assignmentsMappings: [],
                    assignmentsRootFolderId: await createFolderAndGetId(drive, "課題", rootFolderId),
                    materialsMappings: [],
                    materialsRootFolderId: await createFolderAndGetId(drive, "教材", rootFolderId),
                });
            });
        }
    }

    for (const course of courses) {
        const mapping = mappings.get(course.id);

        // Hmm, huge duplicates...

        // Assignments
        const assignmentsMappings = new Map<string, string>(
            (mapping?.assignmentsMappings || []).map(e => [e.id, e.folderId]));
        for (const assignment of course.assignments) {
            const assignmentFolderId =
                assignmentsMappings.get(assignment.id) ||
                mapping?.assignmentsRootFolderId &&
                await createFolderAndGetId(drive, assignment.title, mapping.assignmentsRootFolderId) ||
                undefined;
            if (assignmentFolderId) assignmentsMappings.set(assignment.id, assignmentFolderId);
            for (const file of assignment.attachmentFiles) {
                const fileId = await saveFileToDriveIfNeeded(credentials, drive, driveIdMap, file);
                if (!fileId || !assignmentFolderId) continue;
                drive.files.update({fileId, addParents: assignmentFolderId})
            }
        }
        if (mapping) {
            mapping.assignmentsMappings = Array.from(assignmentsMappings.entries())
                .map(([id, folderId]) => {
                    return {id, folderId};
                });
        }

        // Materials
        const materialsMappings = new Map<string, string>(
            (mapping?.materialsMappings || []).map(e => [e.id, e.folderId]));
        for (const material of course.materials) {
            const materialFolderId =
                materialsMappings.get(material.id) ||
                mapping?.materialsRootFolderId &&
                await createFolderAndGetId(drive, material.title, mapping.materialsRootFolderId) ||
                undefined;
            if (materialFolderId) materialsMappings.set(material.id, materialFolderId);
            for (const item of material.items) {
                if (!materialItemIsFile(item.contents)) continue;
                const fileId = await saveFileToDriveIfNeeded(credentials, drive, driveIdMap, item.contents);
                if (!fileId || !materialFolderId) continue;
                drive.files.update({fileId, addParents: materialFolderId})
            }
        }
        if (mapping) {
            mapping.materialsMappings = Array.from(materialsMappings.entries())
                .map(([id, folderId]) => {
                    return {id, folderId};
                });
        }
    }

    await fs.promises.writeFile(masterJsonPath, JSON.stringify(Object.fromEntries(driveIdMap.entries())));
    await fs.promises.writeFile(mappingJsonPath, JSON.stringify([...mappings.values()]));
};

(async () => {
    const itcLmsJsonPath = "data-store/itc-lms.json";

    const courses = await fs.promises.readFile(itcLmsJsonPath, "utf-8")
        .then(str => createIdMap<Course>(JSON.parse(str)))
        .catch(() => new Map<string, Course>());

    const browser = await puppeteer.launch({headless: !debugMode});

    const page = (await browser.pages())[0];
    if (!await logInToItcLms(page)) throw new Error("Failed to log in");

    // debug purposes
    if (process.env.YOU_THEE_DEBUG_COURSE_ID) {
        // single-course debug mode
        console.log(JSON.stringify(await getCourse(browser)(process.env.YOU_THEE_DEBUG_COURSE_ID)))

        await page.waitFor(6000000);
        return;
    }

    const newCourses = await getAllCourses(browser);
    const credentials = getCredentialsFromCookies(await page.cookies());
    await browser.close();

    await updateDrive(Array.from(courses.values()), credentials);

    const slackClient = new WebClient(process.env.YOU_THEE_SLACK_BOT_USER_TOKEN);

    for (const newCourse of newCourses) {
        const channelId = getSlackChannel(newCourse.id);
        const {channel: {is_member: isMember}} = await slackClient.conversations.info({channel: channelId}) as any;
        if (!isMember) await slackClient.conversations.join({channel: channelId});

        const oldCourse = courses.get(newCourse.id);
        if (oldCourse) {
            for (const postDraft of processCourseDiff(oldCourse, newCourse)) {
                const post = {
                    channel: channelId,
                    ...postDraft,
                } as ChatPostMessageArguments;
                post.text = `授業 ${newCourse.name}\n` + post.text;
                await slackClient.chat.postMessage(post);
                await sleep(2000);
            }
        }
        courses.set(newCourse.id, newCourse);
    }

    await fs.promises.writeFile(itcLmsJsonPath, JSON.stringify(Array.from(courses.values())));
})().catch(console.error);
