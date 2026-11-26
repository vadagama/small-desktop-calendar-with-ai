import type { AgentSettingsState } from "../shared/agent-settings.js";
import type { CalendarToolCall } from "../shared/calendar-tools.js";

export function mayRunCalendarTool(
  message: CalendarToolCall,
  configuration: AgentSettingsState,
) {
  const skillForTool: Record<string, string> = {
    showEventList: "event-list",
    listMeetings: "schedule",
    meetingAnalytics: "analytics",
    searchPeople: "people-search",
    selectParticipants: "people-search",
    participantMemory: "people-search",
    assistantMemory: "people-search",
    findSlots: "availability",
    showAvailabilityAnalysis: "availability",
    prepareMeetingDraft: "meeting-draft",
    prepareMeetingDeletion: "meeting-delete",
    prepareMeetingParticipants: "schedule",
  } as const;
  const skillId = skillForTool[message.name];
  const copiesMeeting =
    message.name === "selectParticipants" &&
    typeof message.input === "object" &&
    message.input !== null &&
    "sourceEventKey" in message.input;
  return !(
    (message.name !== "assistantMemory" &&
      !configuration.settings.skills.some(
        (skill) => skill.id === skillId && skill.enabled,
      )) ||
    (copiesMeeting &&
      !configuration.settings.skills.some(
        (skill) => skill.id === "schedule" && skill.enabled,
      ))
  );
}
