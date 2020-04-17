import {drive_v3, google} from 'googleapis';
import fs from "fs";
import Drive = drive_v3.Drive;

export const createNewOauthClient = () => new google.auth.OAuth2(
    process.env.YOU_THEE_DRIVE_CLIENT_ID,
    process.env.YOU_THEE_DRIVE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob",
);

export const createDriveClient = async (): Promise<Drive> => {
    const oauth2Client = createNewOauthClient();
    oauth2Client.setCredentials(JSON.parse(await fs.promises.readFile("./tokens.json", "utf-8")));
    oauth2Client.on('tokens', (tokens) => {
        // if (tokens.refresh_token) {
        //     // store the refresh_token in my database!
        //     console.log(tokens.refresh_token);
        // }
        // console.log(tokens.access_token);
        console.log("Tokens has been refreshed:");
        console.log(JSON.stringify(tokens));
    });

    return google.drive({version: "v3", auth: oauth2Client});
};
