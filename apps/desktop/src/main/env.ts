import { app } from "electron";
import dotenv from "dotenv";
import path from "path";

export function initEnv() {
  try { dotenv.config({ path: path.join(process.cwd(), ".env") }); } catch {}
  try { dotenv.config({ path: path.join(process.resourcesPath, ".env") }); } catch {}
  try { dotenv.config({ path: path.join(process.resourcesPath, "agent", ".env") }); } catch {}
}

export const isDev = !app.isPackaged;
