// Whole days since a deadline passed, 0 before it or on the day it passed.
export const daysOverdue = (dueAt, now = Date.now()) => Math.max(0, Math.floor((new Date(now).getTime() - new Date(dueAt).getTime()) / 86400000))
