import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../prototype/src/App";
import { SmallAccount } from "./SmallAccount";
import { DesktopAssistant } from "./Assistant";
import "../../prototype/src/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App AssistantPanel={DesktopAssistant} ProfileControl={<SmallAccount />} />
  </StrictMode>,
);
