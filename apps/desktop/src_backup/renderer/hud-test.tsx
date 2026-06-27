import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { CurvedHud } from "./components/ui/CurvedHud";

function HudTestApp() {
    return (
        <div className="w-screen h-screen overflow-hidden bg-transparent">
            <CurvedHud />
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <HudTestApp />
    </React.StrictMode>
);
