interface Course {
    informations: Information[];
    materials: Material[];
    assignments: Assignment[];
}

interface Information {
    title: string;
    contents: string;
    postingPeriod: string;
}

interface Material {
    title: string;
    contents: string;
    publicationPeriod: string;
    items: MaterialItem[];
}

interface MaterialItem {
    title: string;
    comments: string;
    createDate: Date;
    contents: AttachmentFile | AttachmentLink | AttachmentVideo;
}

interface Link {
    url: string;
}

interface AttachmentLink extends Link {
    type: "Link";
}

interface AttachmentVideo extends Link {
    type: "Video";
}

interface Assignment {
    title: string;
    contents: string;
    attachmentFiles: AttachmentFile[];
    submissionPeriod: Period;
    submissionMethod: AssignmentSubmissionMethod;
    lateSubmissionAllowed: boolean;
    // gradeCanBeReferenced: boolean;
    // submissionCrossReferenceEnabled: boolean;
}

enum AssignmentSubmissionMethod {
    UploadFile,
    TextDirectlyInput,
}

interface Period {
    start: Date;
    end: Date;
}

interface AttachmentFile {
    filename: string;
    // sha256sum: string;
}
