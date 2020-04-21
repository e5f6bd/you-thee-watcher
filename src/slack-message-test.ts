import {ChatPostMessageArguments, WebClient} from "@slack/web-api";
import {compareAndCreatePost, createAssignmentPost} from "./itc-lms/slack";
import * as fs from "fs";
import {sameAssignment} from "./itc-lms/utils";

(async () => {
    const slackClient = new WebClient(process.env.YOU_THEE_SLACK_BOT_USER_TOKEN);

    const postDraft = compareAndCreatePost({
        id: "",
        name: "",
        }, undefined, JSON.parse(
        await fs.promises.readFile("data-store/materials.json", "utf-8")),
        sameAssignment, createAssignmentPost
    )[0];

    await slackClient.chat.postMessage({
        channel: process.env.YOU_THEE_SLACK_CHANNEL_ID,
        ...postDraft,
    } as ChatPostMessageArguments);
})().catch(console.error);