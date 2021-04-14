import {createDriveClient} from "./utils";
import * as stream from "stream";
import {promisify} from "util";
import * as tar from "tar";


export const downloadDataStore = async () => {
    const drive = await createDriveClient();
    const {data} = await drive.files.get({
        fileId: process.env.YOU_THEE_DRIVE_DATA_STORE_ID,
        alt: "media",
    }, {responseType: "stream"}) as unknown as { data: stream.PassThrough };
    const pipeline = promisify(stream.pipeline);
    await pipeline(data, tar.extract({path: "."}));
};

export const uploadDataStore = async () => {
    console.log("uploadDataStore() called");
    const drive = await createDriveClient();
    const passThrough = new stream.PassThrough();
    stream.pipeline(tar.create({gzip: true}, ["data-store"]), passThrough, (err) => {
        if (err) {
            throw err;
        }
    })
    console.log("uploadDataStore() is halfway done");

    // If you pass the stream created by tar.create directly to the drive update API,
    // it will not regard is at a readable stream, but an object convertible plain text,
    // because of the implementation of isReadableStream function at the link below:
    // https://github.com/googleapis/nodejs-googleapis-common/blob/1cd8eaa7f16b6b4c10b073e57eceaefc84ccad6f/src/apirequest.ts#L35
    //
    // Therefore, the stream is wrapped with a no-op pass through stream,
    // which in turn will be detected as a readable stream.

    await drive.files.update({
        fileId: process.env.YOU_THEE_DRIVE_DATA_STORE_ID!,
        media: {
            mimeType: "application/gzip",
            // mimeType: "application/octet-stream",
            // body: fs.createReadStream("data-store.tar.gz"),
            body: passThrough,
        },
    });
    console.log("uploadDataStore() successfully ended - hopefully.");
};

// downloadDataStore().catch(console.error);