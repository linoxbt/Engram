"use client";
import { Client } from "appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

/** Browser Appwrite client (Realtime and the setup ping). Null when Appwrite is not configured. */
export const client = endpoint && project ? new Client().setEndpoint(endpoint).setProject(project) : null;

let pinged = false;
/** Ping Appwrite once per page load so the Console can confirm the project is connected. */
export function pingOnce() {
  if (!client || pinged) return;
  pinged = true;
  client.ping().catch(() => undefined);
}
