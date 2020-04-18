import puppeteer from 'puppeteer';
import {
    getAllCourses,
    getAttachmentFileDownloadUrl,
    getCourse,
    getCredentialsFromCookies,
    ItcLmsCredentials,
    logInToItcLms
} from "./itc-lms/api";
import * as fs from "fs";
import {Assignment, AttachmentFile, Course, Material, Notification} from "./itc-lms/types";
import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {createIdMap, distinct, sameSet, sleep} from "./utils";
import {materialItemIsFile, samePeriod} from "./itc-lms/utils";
import fetch from 'node-fetch';
import {createDriveClient, createFolderAndGetId} from "./drive/utils";
import {drive_v3} from "googleapis";
import Schema$File = drive_v3.Schema$File;
import {downloadDataStore, uploadDataStore} from "./drive/data-store";

// Diffs and slack
type PostDraft = Omit<ChatPostMessageArguments, "channel">;

const getSlackChannel = (courseId: string): string => {
    return process.env.YOU_THEE_SLACK_CHANNEL_ID!;
}

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

const checkDiffAndUpdateSlack = async (courses: Map<string, Course>, newCourses: Course[]) => {
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
};

// Files and google drive
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
    // console.log(`Saving ${file.id}`);
    const response = await fetch(getAttachmentFileDownloadUrl(file), {
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        }
    });
    if (!response.ok) {
        // console.error(`Failed to download ${file.id}`);
        console.error(`Failed to download`);
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
    }).catch(async () => {
        // console.error("Failed to upload file", reason)
        console.error("Failed to upload file");
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

// Main function
(async () => {
    await fs.promises.access("data-store").catch(async () => {
        console.log("data-store directory was not found, downloading");
        await downloadDataStore();
    })

    const itcLmsJsonPath = "data-store/itc-lms.json";

    // load stored courses information
    const courses = await fs.promises.readFile(itcLmsJsonPath, "utf-8")
        .then(str => createIdMap<Course>(JSON.parse(str)))
        .catch(() => new Map<string, Course>());

    // prepare a browser and log in
    const browser = await puppeteer.launch({headless: !process.env.YOU_THEE_SHOW_CHROMIUM_WINDOW});
    const page = (await browser.pages())[0];
    if (!await logInToItcLms(page)) throw new Error("Failed to log in");
    const credentials = getCredentialsFromCookies(await page.cookies());
    console.log("Successfully logged in.")

    // debug purposes
    if (process.env.YOU_THEE_DEBUG_COURSE_ID) {
        // single-course debug mode
        console.log(JSON.stringify(await getCourse(browser)(process.env.YOU_THEE_DEBUG_COURSE_ID)))

        await page.waitFor(6000000);
        return;
    }

    // retrieve latest courses information
    const newCourses = await getAllCourses(browser);

    await browser.close();

    await updateDrive(Array.from(courses.values()), credentials);
    await checkDiffAndUpdateSlack(courses, newCourses);

    // save updated courses information to file
    await fs.promises.writeFile(itcLmsJsonPath, JSON.stringify(Array.from(courses.values())));

    // save data store to google drive
    await uploadDataStore();
})().catch(console.error);
