import {AttachmentFile, DateLike, MaterialItemContents, Period} from "./types";
import dayjs from "dayjs";

export const sameDate = (lhs: DateLike, rhs: DateLike): boolean => {
    return dayjs(lhs).isSame(dayjs(rhs));
}
export const samePeriod = (lhs: Period, rhs: Period): boolean => {
    return sameDate(lhs.start, rhs.start) && sameDate(lhs.end, rhs.end);
}

export const materialItemIsFile = (materialItem: MaterialItemContents): materialItem is AttachmentFile => {
    return materialItem.type == "File";
}
