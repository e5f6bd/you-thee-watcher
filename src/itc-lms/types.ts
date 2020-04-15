import {Dayjs} from "dayjs";

export interface Course {
    notifications: Notification[];
    materials: Material[];
    assignments: Assignment[];
}

export interface Notification {
    title: string;
    contents: string;
    postingPeriod: Period;
}

export interface Material {
    title: string;
    contents: string;
    publicationPeriod: Period;
    items: MaterialItem[];
}

export interface MaterialItem {
    title: string;
    comments: string;
    createDate: Dayjs;
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
    start: Dayjs;
    end: Dayjs;
}

export interface AttachmentFile {
    title: string;
    filename: string;
    objectName: string;
}
