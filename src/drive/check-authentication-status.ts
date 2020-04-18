import {createDriveClient} from "./utils";

// Run this file to check the authentication status of Google Drive.
(async () => {
    const drive = await createDriveClient();
    const {data: {user}} = await drive.about.get({fields: "*"});
    console.log(user);
})().catch(console.error);
