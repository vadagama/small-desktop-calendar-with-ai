export type HelpAction =
  | "calendar"
  | "analytics"
  | "memory"
  | "settings"
  | "account"
  | "model"
  | "notifications";
export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  image: string;
  caption: string;
  prompt?: string;
  action?: HelpAction;
  actionLabel?: string;
  note: string;
}
