const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
const date = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
const shortDate = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" })

export const formatTime = (now: number): string => time.format(now)
export const formatDate = (now: number): string => date.format(now)
export const formatShortDate = (now: number): string => shortDate.format(now)
