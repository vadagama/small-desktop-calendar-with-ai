import type { ModelMessage } from "ai";
import type { CalendarPerson } from "../shared/calendar.js";

/** Privileged evidence and complete model turns; never reconstructed from renderer text. */
export class CalendarConversation {
  private accountId: string | null = null;
  private turns: ModelMessage[][] = [];
  people = new Map<string, CalendarPerson>();
  ambiguous = new Map<string, number>();
  selected: string[] = [];
  turn = 0;
  get messages(): ModelMessage[] {
    return this.turns.flat();
  }
  bindAccount(id: string | null) {
    if (this.accountId === id) return;
    this.accountId = id;
    this.turns = [];
    this.people.clear();
    this.ambiguous.clear();
    this.selected = [];
    this.turn = 0;
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
