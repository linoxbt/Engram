import type { Report } from "@engram/core";

export interface CheckpointPointer { fileId: string; seq: number; size: number; root: string; createdAt: string }
export interface IntegrityStatus {
  status: Report["status"];
  validThrough: number;
  entries: number;
  findings: number;
  critical: number;
  checkedAt: string;
  firstFinding: string | null;
}

/** Space settings, stored as Appwrite team preferences (settings have no meaning to embed). */
export interface SpaceSettings {
  spaceKey: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  neighbourDistance: number;
  duplicateDistance: number;
  conceptDistance: number;
  checkpointEvery: number;
  classifierModel: string | null;
  retentionDays: number;
  sandbox: boolean;
  publicVerify: boolean;
  anchoring: boolean;
  latestCheckpoint: CheckpointPointer | null;
  lastAnchorAt: string | null;
  integrity: IntegrityStatus | null;
  /** Display names for people who act in the dashboard (agent field "user:<id>"). */
  people: Record<string, string>;
}

export const SETTING_RANGES = {
  neighbourDistance: { min: 0.05, max: 0.9, label: "Neighbour distance", help: "How close an existing memory must be before Engram checks it for duplicates, supersessions and conflicts. Lower is stricter." },
  duplicateDistance: { min: 0.0, max: 0.3, label: "Duplicate distance", help: "Below this distance, with the same kind and subject, a new memory is treated as a duplicate without asking the model." },
  conceptDistance: { min: 0.05, max: 0.9, label: "Concept distance", help: "How close a memory must be to a concept's centre to join it instead of starting a new concept." },
  checkpointEvery: { min: 1, max: 1000, label: "Checkpoint interval", help: "Sign a checkpoint after this many new entries, in addition to the scheduled run." },
} as const;

export function defaultSettings(args: { spaceKey: string; name: string; ownerId: string; sandbox?: boolean; publicVerify?: boolean; description?: string; local?: boolean }): SpaceSettings {
  // The offline hashing embedder spreads related sentences further apart than
  // nomic-embed-text, so local spaces use looser distance thresholds.
  const local = !!args.local;
  return {
    spaceKey: args.spaceKey,
    name: args.name,
    description: args.description ?? "",
    ownerId: args.ownerId,
    createdAt: new Date().toISOString(),
    neighbourDistance: local ? 0.75 : 0.35,
    duplicateDistance: local ? 0.04 : 0.06,
    conceptDistance: local ? 0.8 : 0.3,
    checkpointEvery: args.sandbox ? 4 : 16,
    classifierModel: null,
    retentionDays: 0,
    sandbox: !!args.sandbox,
    publicVerify: !!args.publicVerify,
    anchoring: false,
    latestCheckpoint: null,
    lastAnchorAt: null,
    integrity: null,
    people: {},
  };
}
