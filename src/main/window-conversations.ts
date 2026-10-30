import { CalendarConversation } from "./calendar-conversation.js";

interface Owner {
  id: number;
  once(event: "destroyed", listener: () => void): unknown;
}

/** Conversation lifetime follows the window, independently of an active model job. */
export class WindowConversations {
  private entries = new Map<
    number,
    { id: string; state: CalendarConversation }
  >();
  private observed = new WeakSet<Owner>();
  get size() {
    return this.entries.size;
  }
  get(owner: Owner, conversationId: string) {
    if (!this.observed.has(owner)) {
      this.observed.add(owner);
      const ownerId = owner.id;
      owner.once("destroyed", () => this.entries.delete(ownerId));
    }
    let entry = this.entries.get(owner.id);
    if (!entry || entry.id !== conversationId) {
      entry = { id: conversationId, state: new CalendarConversation() };
      this.entries.set(owner.id, entry);
    }
    return entry.state;
  }
  clear() {
    this.entries.clear();
  }
}
