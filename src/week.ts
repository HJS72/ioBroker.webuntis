export function getWeekDates(date: Date, weekOffset = 0): Date[] {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + weekOffset * 7);
    return Array.from({ length: 5 }, (_, index) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + index);
        return day;
    });
}