import fs from "fs";
import readline from "readline";
import {createNewOauthClient} from "./drive";

const askQuestion = (query: string): Promise<string> => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
};

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
    const accessCode = await askQuestion("Enter the code you obtained: ");
    const {tokens} = await oauth2Client.getToken(accessCode);
    await fs.promises.writeFile("tokens.json", JSON.stringify(tokens));
    console.log("Successfully saved tokens to tokens.json");
})().catch(console.error);
