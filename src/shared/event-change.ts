export type EventChange =
  { kind: "rename"; title: string } | { kind: "cancel" };
export interface EventChangeQuery {
  accountId: string;
  eventId: string;
  change: EventChange;
}
export interface EventChangePreview {
  operationId?: string;
  eventId: string;
  kind: EventChange["kind"];
  before: {
    title: string;
    description: string;
    location: string;
    startsAt: string;
    endsAt: string;
    participantIds: string[];
  };
  afterTitle: string | null;
  checkedAt: string;
}
