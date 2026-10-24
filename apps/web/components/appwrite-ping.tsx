"use client";
import { useEffect } from "react";
import { pingOnce } from "@/lib/client/appwrite";

export function AppwritePing() {
  useEffect(() => pingOnce(), []);
  return null;
}
