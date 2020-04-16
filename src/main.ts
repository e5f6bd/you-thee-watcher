import puppeteer from 'puppeteer';
import {getAllCourses, getCourse, logInToItcLms} from "./itc-lms/api";
import {promises as fs} from "fs";
import {Assignment, Course, Material, Notification} from "./itc-lms/types";
import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {distinct, sameSet, sleep} from "./utils";
import {samePeriod} from "./itc-lms/utils";

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
        ){
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

(async () => {
    const itcLmsJsonPath = "data-store/itc-lms.json";
    const courses = await fs.open(itcLmsJsonPath, "r")
        .then(async f => {
            const str = await fs.readFile(f, "utf-8");
            await f.close();
            return createIdMap<Course>(JSON.parse(str));
        }).catch(() => new Map<string, Course>());
    console.log(courses);

    const browser = await puppeteer.launch({headless: !debugMode});

    const page = (await browser.pages())[0];
    if (!await logInToItcLms(page)) throw new Error("Failed to log in");
    if (process.env.YOU_THEE_DEBUG_COURSE_ID) {
        // single-course debug mode
        console.log(JSON.stringify(await getCourse(browser)(process.env.YOU_THEE_DEBUG_COURSE_ID)))

        await page.waitFor(6000000);
        return;
    }
    const newCourses = await getAllCourses(browser);
    await browser.close();

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

    await fs.writeFile(itcLmsJsonPath, JSON.stringify(Array.from(courses.values())));
})().catch(console.error);
