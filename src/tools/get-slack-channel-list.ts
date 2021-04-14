import {WebClient} from "@slack/web-api";
import fs from "fs";

type ConversationsListResponse = { channels: unknown[], response_metadata?: { next_cursor: string } };

(async () => {
    const slackClient = new WebClient(process.env.YOU_THEE_SLACK_BOT_USER_TOKEN);
    const channels = [];

    for (let cursor = undefined; ;) {
        const result = await slackClient.conversations.list({cursor}) as unknown as ConversationsListResponse;
        channels.push(...result.channels);
        if (!(cursor = result.response_metadata?.next_cursor)) break;
    }

    await fs.promises.writeFile("ignore/channels.json", JSON.stringify(channels))
})().catch(console.error)