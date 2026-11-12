"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeekDates = void 0;
function getWeekDates(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + index);
        return day;
    });
}
exports.getWeekDates = getWeekDates;
//# sourceMappingURL=week.js.map