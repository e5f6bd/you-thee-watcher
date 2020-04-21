import {Assignment, Course, CourseMetadata, DateLike, Material, Notification} from "./types";
import {createIdMap, distinct, sleep} from "../utils";
import {sameAssignment, sameMaterial, sameNotification} from "./utils";
import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {ContextBlock, SectionBlock} from "@slack/types";
import {getAttachmentFileDownloadUrl, getCourseUrlFromId} from "./api";
import dayjs from "dayjs";
import * as querystring from "querystring";
import utc from 'dayjs/plugin/utc';
import {getDriveViewUrl} from "../drive/utils";

dayjs.extend(utc)

type PostDraft = Omit<ChatPostMessageArguments, "channel">;
const getSlackChannel = (courseId: string): string => {
    return process.env.YOU_THEE_SLACK_CHANNEL_ID!;
}

const mrkdwnTextBlock = (text: string): SectionBlock => {
    return {
        type: "section",
        text: {
            type: "mrkdwn",
            text
        }
    };
};
const escapeSlackString = (str: string): string => {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
};
const createSlackLink = (unescapedLinkText: string, url?: string): string => {
    if (url) {
        return `<${escapeSlackString(url)}|${escapeSlackString(unescapedLinkText)}>`;
    } else {
        return escapeSlackString(unescapedLinkText);
    }
}
const DIVIDER = Object.freeze({type: "divider"});

const dateTimeToLink = (dateLike: DateLike): string => {
    const date = dayjs.utc(dateLike).add(9, "h");
    const dateStr = date.format("YYYY/MM/DD HH:mm");
    const link = "https://www.timeanddate.com/worldclock/fixedtime.html?" + querystring.encode({
        iso: date.format("YYYYMMDDTHHmm"),
        p1: 248,
    });
    return createSlackLink(dateStr, link);
};

export const createCourseContext = (course: CourseMetadata): ContextBlock => {
    return {
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": createSlackLink(course.name, getCourseUrlFromId(course.id)),
            }
        ]
    }
}

// noinspection JSUnusedLocalSymbols
export const createNotificationPost = (
    course: CourseMetadata,
    notification: Notification,
    titleGenerator: (str: string) => string,
    driveIdMap: Map<string, string>,
): PostDraft => {
    const title = titleGenerator(
        `お知らせ「${createSlackLink(notification.title, getCourseUrlFromId(course.id) + "#information")}」`);
    const blocks = [
        mrkdwnTextBlock(title),
        DIVIDER,
        mrkdwnTextBlock(`*公開期間* ${dateTimeToLink(notification.postingPeriod.start)} 〜 ` +
            `${dateTimeToLink(notification.postingPeriod.end)}`),
        mrkdwnTextBlock("*コメント*\n" + escapeSlackString(notification.contents)),
        createCourseContext(course),
    ];
    return {
        text: title,
        blocks,
    };
}
export const createMaterialPost = (
    course: CourseMetadata,
    material: Material,
    titleGenerator: (str: string) => string,
    driveIdMap: Map<string, string>,
): PostDraft => {
    const title = titleGenerator(
        `教材「${createSlackLink(material.title, getCourseUrlFromId(course.id) + "#materialContents")}」`);
    const blocks = [
        mrkdwnTextBlock(title),
        DIVIDER,
        mrkdwnTextBlock(`*公開期間* ${dateTimeToLink(material.publicationPeriod.start)} 〜 ` +
            `${dateTimeToLink(material.publicationPeriod.end)}`),
        mrkdwnTextBlock(`*コメント*\n${material.contents}`),
        DIVIDER,
    ];
    for (const item of material.items) {
        let url = getCourseUrlFromId(course.id) + "#" + item.id;
        switch (item.contents.type) {
            case "File":
                const driveFileId = driveIdMap.get(item.contents.id);
                if(driveFileId) url = getDriveViewUrl(driveFileId);
                break;
            case "Link":
            case "Video":
                url = item.contents.url;
                break;
        }
        let blockText = "•\t";
        blockText += createSlackLink(item.title, url);
        blockText += " ";
        blockText += escapeSlackString(item.comments);
        blocks.push(mrkdwnTextBlock(blockText));
    }
    blocks.push(
        DIVIDER,
        createCourseContext(course),
    );
    return {
        text: title,
        blocks,
    };
}
export const createAssignmentPost = (
    course: CourseMetadata,
    assignment: Assignment,
    titleGenerator: (str: string) => string,
    driveIdMap: Map<string, string>,
): PostDraft => {
    const title = titleGenerator(
        `課題「${createSlackLink(assignment.title, "https://itc-lms.ecc.u-tokyo.ac.jp/lms/course/report/submission?" + querystring.encode({
            idnumber: course.id,
            reportId: assignment.id,
        }))}」`);
    const blocks = [
        mrkdwnTextBlock(title),
        DIVIDER,
        mrkdwnTextBlock(`*提出期限* ${dateTimeToLink(assignment.submissionPeriod.start)} 〜 ` +
            `${dateTimeToLink(assignment.submissionPeriod.end)}\n` +
            `（期間外提出： ${assignment.lateSubmissionAllowed ? "可" : "不可"})`),
        mrkdwnTextBlock("*内容*\n" + escapeSlackString(assignment.contents)),
    ];
    if (assignment.attachmentFiles.length > 0) blocks.push(DIVIDER);
    for (const item of assignment.attachmentFiles) {
        const driveFileId = driveIdMap.get(item.id);
        const url = driveFileId ? getDriveViewUrl(driveFileId) : getAttachmentFileDownloadUrl(item);
        let blockText = "•\t";
        blockText += createSlackLink(item.title, url);
        blocks.push(mrkdwnTextBlock(blockText));
    }
    blocks.push(
        DIVIDER,
        createCourseContext(course),
    );
    return {
        text: title,
        blocks,
    };
}

export const compareAndCreatePost = <T extends { id: string }>(
    course: CourseMetadata,
    oldOne: T | undefined,
    newOne: T | undefined,
    itemsAreSame: (a: T, b: T) => boolean,
    itemToPost: (course: CourseMetadata, item: T, titleGenerator: (str: string) => string,
                 driveIdMap: Map<string, string>) => PostDraft,
    driveIdMap: Map<string, string>,
): PostDraft[] => {
    if (oldOne && newOne) {
        if (!itemsAreSame(oldOne, newOne)) {
            return [itemToPost(course, newOne, str => `${str}の内容が変更されました。`, driveIdMap)]
        }
    } else if (oldOne) {
        return [itemToPost(course, oldOne, str => `${str}が削除されました。`, driveIdMap)]
    } else if (newOne) {
        return [itemToPost(course, newOne, str => `${str}が追加されました。`, driveIdMap)]
    }
    return [];
}

export const processCourseDiff = (oldCourse: Course, newCourse: Course, driveIdMap: Map<string, string>): PostDraft[] => {
    const posts: PostDraft[] = [];
    const processDifferences = <T extends { id: string }>(
        olds: T[],
        news: T[],
        itemsAreSame: (a: T, b: T) => boolean,
        itemToPost: (course: CourseMetadata, item: T, titleGenerator: (str: string) => string,
                     driveIdMap: Map<string, string>) => PostDraft,
    ) => {
        const oldMap = createIdMap(olds);
        const newMap = createIdMap(news);
        for (const id of distinct([...oldMap.keys(), ...newMap.keys()])) {
            posts.push(...compareAndCreatePost(
                newCourse, oldMap.get(id), newMap.get(id), itemsAreSame, itemToPost, driveIdMap));
        }
    }
    processDifferences(oldCourse.notifications, newCourse.notifications, sameNotification, createNotificationPost);
    processDifferences(oldCourse.assignments, newCourse.assignments, sameAssignment, createAssignmentPost);
    processDifferences(oldCourse.materials, newCourse.materials, sameMaterial, createMaterialPost);
    return posts;
};

export const checkDiffAndUpdateSlack = async (
    courses: Map<string, Course>,
    newCourses: Course[],
    driveIdMap: Map<string, string>,
) => {
    const slackClient = new WebClient(process.env.YOU_THEE_SLACK_BOT_USER_TOKEN);

    for (const newCourse of newCourses) {
        const channelId = getSlackChannel(newCourse.id);
        const {channel: {is_member: isMember}} = await slackClient.conversations.info({channel: channelId}) as any;
        if (!isMember) await slackClient.conversations.join({channel: channelId});

        const oldCourse = courses.get(newCourse.id);
        if (oldCourse) {
            for (const postDraft of processCourseDiff(oldCourse, newCourse, driveIdMap)) {
                const post = {
                    channel: channelId,
                    ...postDraft,
                } as ChatPostMessageArguments;
                await slackClient.chat.postMessage(post);
                await sleep(2000);
            }
        }
        courses.set(newCourse.id, newCourse);
    }
};