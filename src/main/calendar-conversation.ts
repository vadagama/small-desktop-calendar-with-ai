import type { ModelMessage } from "ai";
import type { CalendarPerson } from "../shared/calendar.js";
import type { MemoryPreset, TaskOption } from "../shared/assistant-memory.js";
import type { TaskPreferences } from "./meeting-preferences.js";
import { MemoryReviewSession } from "./memory-review.js";

/** Privileged evidence and complete model turns; never reconstructed from renderer text. */
export class CalendarConversation {
  private accountId: string | null = null;
  private turns: ModelMessage[][] = [];
  people = new Map<string, CalendarPerson>();
  ambiguous = new Map<string, number>();
  selected: string[] = [];
  selectionConfirmed = false;
  turn = 0;
  memoryRevision: number | undefined;
  taskPreferences: TaskPreferences = {};
  observedMeetings = new Map<
    string,
    import("../shared/schedule.js").ScheduleResult["events"][number]
  >();
  meetingSource:
    | {
        key: string;
        title: string;
        agenda: string;
        location: string;
        durationMinutes: number;
      }
    | undefined;
  preset: MemoryPreset | undefined;
  taskOptions:
    { options: TaskOption[]; turn: number; expires: number } | undefined;
  hasTaskEvidence(evidence: string, prompt: string) {
    if (/^(?:да|ага|ок|ok|yes|[1-5])[.!]?$/iu.test(evidence.trim()))
      return false;
    return (
      prompt.includes(evidence) ||
      this.turns.some((turn) =>
        turn.some(
          (message) =>
            message.role === "user" &&
            typeof message.content === "string" &&
            message.content.includes(evidence),
        ),
      )
    );
  }
  acceptTaskChoice(prompt: string) {
    const pending = this.taskOptions;
    this.taskOptions = undefined;
    if (!pending || pending.turn >= this.turn || pending.expires < Date.now())
      return;
    const reply = prompt.trim().replace(/[.!]$/, "");
    const index = /^[1-5]$/.test(reply)
      ? Number(reply) - 1
      : /^(?:да|ага|ок|ok|yes)$/iu.test(reply) && pending.options.length === 1
        ? 0
        : -1;
    const option = pending.options[index];
    if (option)
      this.taskPreferences = { ...this.taskPreferences, ...option.preferences };
    else if (/^(?:да|ага|ок|ok|yes|[1-5])$/iu.test(reply))
      this.taskOptions = pending;
  }
  memoryReview = new MemoryReviewSession();
  forgetMemoryEvidence(revision: number | undefined) {
    if (revision !== undefined && this.memoryRevision === revision) return;
    // Whole turns are removed so tool calls cannot be separated from their results.
    this.turns = this.turns.filter(
      (turn) =>
        !JSON.stringify(turn).match(
          /participantMemory|assistantMemory|memoryPolicy/,
        ),
    );
    this.memoryRevision = revision;
    this.memoryReview.clear();
    this.taskOptions = undefined;
    this.preset = undefined;
    this.selected = [];
    this.selectionConfirmed = false;
    this.people.clear();
    this.ambiguous.clear();
  }
  get messages(): ModelMessage[] {
    return this.turns.flat();
  }
  bindAccount(id: string | null) {
    if (this.accountId === id) return;
    this.accountId = id;
    this.memoryReview.clear();
    this.turns = [];
    this.people.clear();
    this.ambiguous.clear();
    this.selected = [];
    this.selectionConfirmed = false;
    this.turn = 0;
    this.memoryRevision = undefined;
    this.taskOptions = undefined;
    this.observedMeetings.clear();
    this.meetingSource = undefined;
    this.taskPreferences = {};
    this.preset = undefined;
  }
  commit(prompt: string, response: ModelMessage[]) {
    this.turns.push([{ role: "user", content: prompt }, ...response]);
    // Drop whole turns, never split tool calls from results.
    while (
      this.turns.length > 12 ||
      (this.turns.length > 1 && JSON.stringify(this.turns).length > 100_000)
    )
      this.turns.shift();
  }
}
