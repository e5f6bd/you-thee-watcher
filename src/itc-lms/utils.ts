import {DateLike, Period} from "./types";
import dayjs from "dayjs";

export const sameDate = (lhs: DateLike, rhs: DateLike): boolean => {
    return dayjs(lhs).isSame(dayjs(rhs));
}
export const samePeriod = (lhs: Period, rhs: Period): boolean => {
    return sameDate(lhs.start, rhs.start) && sameDate(lhs.end, rhs.end);
}
