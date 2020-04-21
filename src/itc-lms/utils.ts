import {Assignment, AttachmentFile, DateLike, Material, MaterialItemContents, Notification, Period} from "./types";
import dayjs from "dayjs";
import {sameSet} from "../utils";

export const sameDate = (lhs: DateLike, rhs: DateLike): boolean => {
    return dayjs(lhs).isSame(dayjs(rhs));
}
export const samePeriod = (lhs: Period, rhs: Period): boolean => {
    return sameDate(lhs.start, rhs.start) && sameDate(lhs.end, rhs.end);
}
export const sameNotification = (lhs: Notification, rhs: Notification) => {
    return lhs.title === rhs.title &&
        lhs.contents === rhs.contents &&
        samePeriod(lhs.postingPeriod, rhs.postingPeriod);
};
export const sameAssignment = (lhs: Assignment, rhs: Assignment) => {
    return lhs.title === rhs.title &&
        lhs.contents === rhs.contents &&
        sameSet(lhs.attachmentFiles.map(x => x.id), rhs.attachmentFiles.map(x => x.id)) &&
        samePeriod(lhs.submissionPeriod, rhs.submissionPeriod) &&
        lhs.submissionMethod === rhs.submissionMethod &&
        lhs.lateSubmissionAllowed === rhs.lateSubmissionAllowed;
};
export const sameMaterial = (lhs: Material, rhs: Material) => {
    return lhs.title === rhs.title &&
        lhs.contents === rhs.contents &&
        sameSet(lhs.items.map(x => x.id), rhs.items.map(x => x.id)) &&
        samePeriod(lhs.publicationPeriod, rhs.publicationPeriod);
};

export const materialItemIsFile = (materialItem: MaterialItemContents): materialItem is AttachmentFile => {
    return materialItem.type == "File";
}

