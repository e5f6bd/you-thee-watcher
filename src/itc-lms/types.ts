import {Dayjs} from "dayjs";

export type DateLike = Dayjs | string;

export interface Course {
    id: string;
    name: string;
    notifications: Notification[];
    materials: Material[];
    assignments: Assignment[];
}

export interface Notification {
    id: string;
    title: string;
    contents: string;
    postingPeriod: Period;
}

export interface Material {
    id: string;
    // In some rare occasion (where the material does not have any items), material ID is not available.
    // In such case, this will be a empty string.
    // Therefore, material ID is not guaranteed to be unique.
    title: string;
    contents: string;
    publicationPeriod: Period;
    items: MaterialItem[];
}

export interface MaterialItem {
    id: string;
    title: string;
    comments: string;
    createDate: DateLike;
    contents: MaterialItemContents;
}

export type MaterialItemContents = AttachmentFile | AttachmentLink | AttachmentVideo

export interface Link {
    url: string;
}

export interface AttachmentLink extends Link {
    type: "Link";
}

export interface AttachmentVideo extends Link {
    type: "Video";
}

export interface Assignment {
    id: string;
    title: string;
    contents: string;
    attachmentFiles: AttachmentFile[];
    submissionPeriod: Period;
    submissionMethod: AssignmentSubmissionMethod;
    lateSubmissionAllowed: boolean;
    // gradeCanBeReferenced: boolean;
    // submissionCrossReferenceEnabled: boolean;
}

export enum AssignmentSubmissionMethod {
    UploadFile,
    TextDirectlyInput,
}

export interface Period {
    start: DateLike;
    end: DateLike;
}

export interface AttachmentFile {
    type: "File";
    id: string;  // Which is called objectName in the website
    title: string;
    filename: string;
}
