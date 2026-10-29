import { createContext, useContext } from "react";
import Markdown from "react-markdown";
import type { AssistantTemplates } from "../shared/agent-settings.js";
export const AssistantPresentation = createContext<{
  templates: AssistantTemplates | null;
  choose: (text: string) => void;
  disabled: boolean;
}>({ templates: null, choose: () => {}, disabled: true });
export const useAssistantPresentation = () => useContext(AssistantPresentation);
export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="assistant-markdown">
      <Markdown
        skipHtml
        components={{
          // External resources never load on rendering model text.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ children, href }) => <span title={href}>{children}</span>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
export function TemplateMarkdown({
  name,
  values = {},
}: {
  name: keyof AssistantTemplates;
  values?: Record<string, string>;
}) {
  const { templates } = useAssistantPresentation();
  if (!templates) return null;
  const text = templates[name].replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    (values[key] ?? "").replace(/[\\`*_{}\[\]()#+.!|<>-]/g, "\\$&"),
  );
  return <AssistantMarkdown>{text}</AssistantMarkdown>;
}
