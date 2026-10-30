import { randomUUID } from "node:crypto";
import { isMemoryRequest } from "./memory-review.js";
import { MemoryError, type AssistantMemoryStore } from "./assistant-memory.js";
import type {
  MemoryChange,
  MemoryProposal,
} from "../shared/assistant-memory.js";

export class MemoryProposals {
  private pending = new Map<
    string,
    {
      proposal: MemoryProposal;
      owner: number;
      epoch: number;
      expires: number;
      binding?: { participantId: string; alias: string };
    }
  >();
  constructor(
    private store: AssistantMemoryStore,
    private validate?: (account: string, change: MemoryChange) => Promise<void>,
  ) {}
  async propose(
    accountId: string,
    owner: number,
    epoch: number,
    prompt: string,
    change: MemoryChange,
    messageId: string,
    binding?: { participantId: string; alias: string },
  ): Promise<MemoryProposal> {
    if (!isMemoryRequest(prompt))
      throw new MemoryError(
        "Для изменения памяти нужна явная просьба пользователя.",
      );
    const state = await this.store.read(accountId);
    if (
      (change.action === "entry" ||
        change.action === "group" ||
        change.action === "preset") &&
      change.id
    ) {
      const items =
        change.action === "entry"
          ? state.entries
          : change.action === "group"
            ? state.groups
            : state.presets;
      if (!items.some((item) => item.id === change.id))
        throw new MemoryError(
          "Запись с таким id отсутствует. Для новой записи повторите propose без id; для редактирования сначала получите актуальный id через recall. Не восстанавливайте удалённые записи без просьбы пользователя.",
        );
    }
    const proposal: MemoryProposal = {
      kind: "memory-proposal",
      id: randomUUID(),
      accountId,
      revision: state.revision,
      change,
      source: { kind: "chat", at: new Date().toISOString(), messageId },
      ...(change.action === "delete"
        ? {
            label: state[change.category]
              .map((e) => ({ id: e.id, label: "text" in e ? e.text : e.name }))
              .find((e) => e.id === change.id)?.label,
          }
        : {}),
      ...(change.action === "preset" && change.value.groupId
        ? {
            groupName: state.groups.find((g) => g.id === change.value.groupId)
              ?.name,
          }
        : {}),
    };
    if (this.pending.size >= 100)
      this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(proposal.id, {
      proposal,
      owner,
      epoch,
      expires: Date.now() + 10 * 60_000,
      ...(binding ? { binding } : {}),
    });
    return proposal;
  }
  async confirm(
    account: string,
    id: string,
    owner: number,
    epoch: number,
    assertCurrent: () => void,
  ) {
    const item = this.pending.get(id);
    if (
      !item ||
      item.proposal.accountId !== account ||
      item.owner !== owner ||
      item.epoch !== epoch ||
      item.expires < Date.now()
    )
      throw new MemoryError(
        "Подтверждение устарело или недоступно. Повторите просьбу в чате.",
      );
    await this.validate?.(account, item.proposal.change);
    assertCurrent();
    return this.store.write(
      account,
      {
        revision: item.proposal.revision,
        requestId: id,
        change: item.proposal.change,
      },
      item.proposal.source,
      assertCurrent,
      item.binding,
    );
  }
}
