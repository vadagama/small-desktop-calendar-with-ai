import type { AvailabilityOpening } from "../shared/availability-analysis.js";
/** Read-only view state belongs to one window; never persisted in memory/vaults. */
export class AvailabilitySessions {
  private states = new Map<
    number,
    {
      context?: AvailabilityOpening;
      closedRequest?: string;
      calls: Set<string>;
    }
  >();
  private state(owner: number) {
    let state = this.states.get(owner);
    if (!state) {
      state = { calls: new Set() };
      this.states.set(owner, state);
    }
    return state;
  }
  set(owner: number, context: AvailabilityOpening) {
    this.state(owner).context = structuredClone(context);
  }
  context(owner: number, account: string) {
    const state = this.states.get(owner);
    if (state?.context?.query.accountId !== account) {
      this.states.delete(owner);
      return undefined;
    }
    return state.context;
  }
  close(owner: number, request?: string) {
    const state = this.state(owner);
    delete state.context;
    if (request) state.closedRequest = request;
  }
  deliver(owner: number, request: string, call: string) {
    const state = this.state(owner);
    const identity = `${request}:${call}`;
    if (state.closedRequest === request || state.calls.has(identity))
      return false;
    state.calls.add(identity);
    if (state.calls.size > 100)
      state.calls.delete(state.calls.values().next().value!);
    return true;
  }
  destroy(owner: number) {
    this.states.delete(owner);
  }
  clear() {
    this.states.clear();
  }
}
