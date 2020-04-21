import {drive_v3, google} from 'googleapis';
import fs from "fs";
import Drive = drive_v3.Drive;

export const createNewOauthClient = () => new google.auth.OAuth2(
    process.env.YOU_THEE_DRIVE_CLIENT_ID,
    process.env.YOU_THEE_DRIVE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob",
);

const TOKENS_PATH = "./tokens.json";

export const createDriveClient = async (): Promise<Drive> => {
    const oauth2Client = createNewOauthClient();
    oauth2Client.setCredentials(JSON.parse(await fs.promises.readFile(TOKENS_PATH, "utf-8")));
    oauth2Client.on('tokens', async (tokens) => {
        // if (tokens.refresh_token) {
        //     // store the refresh_token in my database!
        //     console.log(tokens.refresh_token);
        // }
        // console.log(tokens.access_token);
        // console.log("Tokens has been refreshed:");
        // console.log(JSON.stringify(tokens));

        const oldTokens = JSON.parse(await fs.promises.readFile(TOKENS_PATH, "utf-8"));
        const newTokens = Object.assign({}, oldTokens, tokens);
        await fs.promises.writeFile(TOKENS_PATH, JSON.stringify(newTokens));

        console.log("Tokens has been refreshed.");
    });

    return google.drive({version: "v3", auth: oauth2Client});
};

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export const createFolderAndGetId = async (drive: drive_v3.Drive, name: string, ...parents: string[]) => {
    let response = await drive.files.create({
        requestBody: {
            name: name,
            parents: parents,
            mimeType: DRIVE_FOLDER_MIME_TYPE,
        },
        fields: "id",
    });
    return response.data.id!;
};

export const getDriveViewUrl = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/view?usp=sharing`