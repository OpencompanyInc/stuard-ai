import React from "react";
import ReactDOM from "react-dom/client";
import { VoiceModeView } from "./views/VoiceModeView";
import "./styles.css";

const handleClose = () => {
  // Use Electron IPC if available, otherwise just log
  if ((window as any).ipcRenderer) {
    (window as any).ipcRenderer.invoke("system:closeVoiceTest");
  } else {
    window.close();
  }
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <VoiceModeView demo onClose={handleClose} />
    </div>
  </React.StrictMode>
);
