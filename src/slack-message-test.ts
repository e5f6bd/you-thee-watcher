import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {compareAndCreatePost, createMaterialPost} from "./itc-lms/slack";
import * as fs from "fs";
import {sameMaterial} from "./itc-lms/utils";

(async () => {
    const slackClient = new WebClient(process.env.YOU_THEE_SLACK_BOT_USER_TOKEN);

    const postDraft = compareAndCreatePost(
        JSON.parse(await fs.promises.readFile("data-store/course.json", "utf-8")),
        undefined,
        JSON.parse(await fs.promises.readFile("data-store/materials.json", "utf-8")),
        sameMaterial, createMaterialPost,
        new Map(Object.entries(JSON.parse(await fs.promises.readFile("data-store/itc-lms-drive-master.json", "utf-8")))),
    )[0];

    await slackClient.chat.postMessage({
        channel: process.env.YOU_THEE_SLACK_CHANNEL_ID,
        ...postDraft,
    } as ChatPostMessageArguments);
})().catch(console.error);