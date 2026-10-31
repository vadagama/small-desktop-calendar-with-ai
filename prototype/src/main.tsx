import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { VoiceDemoProvider } from "./VoiceInput";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceDemoProvider>
      <App />
    </VoiceDemoProvider>
  </StrictMode>,
);
