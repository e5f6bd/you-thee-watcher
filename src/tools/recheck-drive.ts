import * as fs from "fs";
import {createDriveClient} from "../drive/utils";
import {AttachmentFile, Course} from "../itc-lms/types";
import {getAttachmentFileDownloadUrl, ItcLmsCredentials} from "../itc-lms/api";
import fetch from 'node-fetch';
import util from "util";
import stream from "stream";
import {drive_v3} from "googleapis";

const pipeline = util.promisify(stream.pipeline);

const arrayEqual = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length != b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
    return true;
}

const processFile = async (
    course: Course,
    file: AttachmentFile,
    credentials: ItcLmsCredentials,
    drive: drive_v3.Drive,
    lmsId: string,
    driveId: string
) => {
    const url = getAttachmentFileDownloadUrl(course.id, file);
    const response = await fetch(url, {
        redirect: "error",
        headers: {
            "Cookie": `ing=${credentials.ing}; JSESSIONID=${credentials.JSESSIONID}`
        }
    });
    const tmpFile = await drive.files.create({
        requestBody: {
            name: file.filename,
        },
        media: {
            mimeType: "application/octet-stream",
            body: response.body,
        },
        fields: "id,mimeType",
    });
    if (tmpFile.status !== 200) {
        console.log(course.id, course.name, lmsId, driveId, "Failed to upload to temp file");
    }
    const {data: dataNew} = await drive.files.get({
        fileId: tmpFile.data.id as string,
        alt: "media",
    }, {responseType: "stream"}) as unknown as { data: stream.PassThrough };
    let result = await drive.files.update({
        fileId: driveId,
        media: {
            mimeType: tmpFile.data.mimeType as string,
            body: dataNew,
        },
    });
    await drive.files.delete({
        fileId: tmpFile.data.id as string
    });
    if (result.status == 200) {
        console.log(course.id, course.name, lmsId, driveId, "Updated");
    } else {
        console.log(course.id, course.name, lmsId, driveId, "Failed to upload", result);
    }
};

(async () => {
    const docTypeHeader = new Uint8Array([
        0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, 0x68, 0x74, 0x6d, 0x6c, 0x3e,
    ]);
    const drive = await createDriveClient();
    const credentials = {
        ing: process.env.YOU_THEE_ITC_LMS_ING!,
        JSESSIONID: process.env.YOU_THEE_ITC_LMS_JSESSION_ID!,
    }

    const courses: Course[] = JSON.parse(
        await fs.promises.readFile("data-store/itc-lms.json", "utf-8")
    );
    const drive_master: Map<string, string> = new Map(Object.entries(JSON.parse(
        await fs.promises.readFile("data-store/itc-lms-drive-master.json", "utf-8")
    )));

    for (const course of courses) {
        const assignmentFiles = course.assignments.flatMap(a => a.attachmentFiles);
        const materialFiles = course.materials.flatMap(m => m.items.flatMap(i => {
            if (i.contents.type === "File") return [i.contents];
            else return [];
        }));
        const files = assignmentFiles.concat(materialFiles);
        for (const file of files) {
            const lmsId = file.id;
            const driveId = drive_master.get(file.id);
            if (!driveId) {
                console.log(course.id, course.name, lmsId, "Not found");
                continue;
            }
            const {data} = await drive.files.get({
                fileId: driveId as string,
                alt: "media",
            }, {
                responseType: "arraybuffer",
                headers: {
                    Range: `bytes=0-${docTypeHeader.length - 1}`,
                }
            }) as unknown as { data: ArrayBuffer };
            if (!arrayEqual(new Uint8Array(data), docTypeHeader)) {
                console.log(course.id, course.name, lmsId, driveId, "Skipping");
                continue;
            }

            await processFile(course, file, credentials, drive, lmsId, driveId);
        }
    }
})().catch(console.error);