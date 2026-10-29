export type CalendarId = "personal" | "team" | "room";
export type View = "day" | "week" | "month";
export type Layout = "right" | "left" | "bottom" | "top";
export type DataState = "ready" | "loading" | "empty" | "error" | "denied";
export interface Meeting {
  participation?: "organizer" | "invited" | "informed" | "unknown";
  accepted?: boolean;
  organizer: string;
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  calendar: CalendarId;
  color: "green" | "blue" | "peach" | "purple";
  people: string[];
  location: string;
  agenda: string;
  created?: boolean;
}
export interface Slot {
  date: string;
  start: number;
  duration: number;
}
export interface Draft extends Slot {
  title: string;
  people: string[];
  agenda: string;
}
