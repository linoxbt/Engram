"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface SpaceInfoResponse {
  key: string;
  /** "viewer" is a read-only guest (the live demo): every write is refused with 403 read_only. */
  role: "owner" | "member" | "viewer";
  /** Classifier models this server accepts; absent on older servers. */
  allowedModels?: string[];
  user: { id: string; name: string; email: string };
  publicKey: string | null;
  keyId: string;
  signing: { inline: boolean; function: boolean };
  backend: "appwrite" | "local";
  appUrl: string;
  settings: {
    spaceKey: string; name: string; description: string; ownerId: string; createdAt: string;
    neighbourDistance: number; duplicateDistance: number; conceptDistance: number; checkpointEvery: number;
    classifierModel: string | null; retentionDays: number; sandbox: boolean; publicVerify: boolean; anchoring: boolean;
    latestCheckpoint: { fileId: string; seq: number; size: number; root: string; createdAt: string } | null;
    lastAnchorAt: string | null;
    integrity: { status: "valid" | "warning" | "tampered"; validThrough: number; entries: number; findings: number; critical: number; checkedAt: string; firstFinding: string | null } | null;
    /** A demo story still being written in slices; null or absent when idle. */
    seeding?: { variant: "demo" | "sandbox"; next: number; total: number } | null;
  };
}

export function useSpaceInfo(key: string) {
  return useQuery({ queryKey: ["space", key, "info"], queryFn: () => api<SpaceInfoResponse>(`/api/app/spaces/${key}`) });
}
