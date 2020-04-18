import fs from "fs";
import {createNewOauthClient} from "./utils";
import {askQuestionViaStdin} from "../utils";

// Run this file to generate tokens.json.
(async () => {
    const oauth2Client = createNewOauthClient();

    const scopes = [
        "https://www.googleapis.com/auth/drive",
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
    });

    console.log(`Please access ${url} and obtain your access token.`);
    const accessCode = await askQuestionViaStdin("Enter the code you obtained: ");
    const {tokens} = await oauth2Client.getToken(accessCode);
    await fs.promises.writeFile("tokens.json", JSON.stringify(tokens));
    console.log("Successfully saved tokens to tokens.json");
})().catch(console.error);
