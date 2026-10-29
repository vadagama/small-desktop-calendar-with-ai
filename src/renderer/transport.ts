import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { AssistantBridge } from "../shared/assistant.js";

// https://ai-sdk.dev/docs/ai-sdk-ui/transport — native chunks over narrow IPC.
export class DesktopTransport implements ChatTransport<UIMessage> {
  private active = new Set<() => void>();
  constructor(private bridge: AssistantBridge) {}

  async sendMessages({
    messages,
    chatId,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    abortSignal?.throwIfAborted();
    const prompt =
      messages
        .findLast((message) => message.role === "user")
        ?.parts.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") ?? "";
    const requestId = crypto.randomUUID();
    let cancel = () => {};
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false;
        const cleanup = () => {
          closed = true;
          unsubscribe();
          abortSignal?.removeEventListener("abort", cancel);
          this.active.delete(cancel);
        };
        const fail = (error: Error) => {
          if (closed) return;
          cleanup();
          controller.error(error);
        };
        const unsubscribe = this.bridge.subscribe((event) => {
          if (closed || event.requestId !== requestId) return;
          if (event.type === "chunk") controller.enqueue(event.chunk);
          else {
            cleanup();
            controller.close();
          }
        });
        cancel = () => {
          if (closed) return;
          void this.bridge.cancel(requestId).catch(() => {});
          fail(new DOMException("Запрос остановлен", "AbortError"));
        };
        this.active.add(cancel);
        abortSignal?.addEventListener("abort", cancel, { once: true });
        if (abortSignal?.aborted) {
          cancel();
          return;
        }
        void this.bridge
          .start({ requestId, prompt, conversationId: chatId })
          .then((result) => {
            if (!result.ok) fail(new Error(result.error));
          })
          .catch(() => fail(new Error("Не удалось запустить ассистента")));
      },
      cancel: () => cancel(),
    });
  }

  async reconnectToStream() {
    return null;
  }
  close = () => {
    for (const cancel of [...this.active]) cancel();
  };
}
