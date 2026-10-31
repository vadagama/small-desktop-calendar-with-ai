import { Help as Guide } from "../../src/renderer/ui/Help";
import { helpArticles, type HelpAction } from "./help-content";
export function Help(props: {
  onPrompt: (text: string) => void;
  onAction: (action: HelpAction) => void;
}) {
  return <Guide {...props} articles={helpArticles} />;
}
