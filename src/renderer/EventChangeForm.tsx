import type { ReactNode } from "react";
import type { CalendarEvent } from "../shared/calendar.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import { NewMeeting } from "./NewMeeting.js";

export function EventChangeForm({
  accountId,
  event,
  expired,
  saved,
  locked,
  close,
  notice,
}: {
  accountId: string;
  event: CalendarEvent;
  expired: () => void;
  saved: () => void;
  locked: boolean;
  close: () => void;
  notice?: ReactNode;
}) {
  return (
    <NewMeeting
      account={{ id: accountId, name: event.organizer }}
      initialDate={calendarDateAt(event.startsAt)}
      editEvent={event}
      expired={expired}
      saved={saved}
      created={() => {}}
      close={close}
      disabled={locked}
      notice={notice}
    />
  );
}
