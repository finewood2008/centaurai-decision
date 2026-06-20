// Side-channel "guest" panelists for the meeting (AI roundtable).
//
// Some agent backends (OpenClaw, Hermes) declare no MCP http/sse capability in
// their ACP handshake, so aioncore reports `behavior_policy.supports_team=false`
// and they cannot join a backend `team_run` — the team-coordination MCP can't be
// injected into them. To still hear their voice, we run them OUT of the team_run
// as plain single-turn ACP conversations ("guests") and inject their opinion into
// the live run as moderator context. Guests are a renderer-only concept, persisted
// per-team in localStorage (they are never sent to `POST /api/teams`).

import type { IProvider } from '@/common/config/storage';
import type { TeamAgentOption } from '../components/agentSelectUtils';

/** A non-team-capable agent the boss invited as a side-channel guest panelist. */
export type MeetingGuest = {
  /** Stable id. For backend extras (openclaw/hermes) it's the backend slug — one per
   *  backend. For a 直连模型专家 it's `model:<provider_id>:<model>` — one per model. */
  id: string;
  /** Execution backend used to spawn the conversation (`openclaw`/`hermes`/`aionrs`). */
  agent_type: string;
  /** Display name. */
  agent_name: string;
  /** Icon / avatar token (SVG filename, emoji, or avatar-map key). */
  icon?: string;
  /** Set for a 直连模型专家 — pins the aionrs conversation to a specific provider model. */
  provider_id?: string;
  model_name?: string;
};

const GUESTS_KEY = 'team-meeting-guests';

type GuestMap = Record<string, MeetingGuest[]>;

function readMap(): GuestMap {
  try {
    const raw = localStorage.getItem(GUESTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as GuestMap;
  } catch {
    // ignore malformed storage
  }
  return {};
}

function writeMap(map: GuestMap): void {
  try {
    localStorage.setItem(GUESTS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

/** Guests invited to a given team's meetings. */
export function readGuests(team_id: string): MeetingGuest[] {
  const list = readMap()[team_id];
  return Array.isArray(list) ? list : [];
}

/** Add (or replace, by id) a guest; returns the updated list. */
export function addGuest(team_id: string, guest: MeetingGuest): MeetingGuest[] {
  const map = readMap();
  const list = Array.isArray(map[team_id]) ? map[team_id] : [];
  const next = [...list.filter((g) => g.id !== guest.id), guest];
  map[team_id] = next;
  writeMap(map);
  return next;
}

/** Remove a guest by id; returns the updated list. */
export function removeGuest(team_id: string, guest_id: string): MeetingGuest[] {
  const map = readMap();
  const list = Array.isArray(map[team_id]) ? map[team_id] : [];
  const next = list.filter((g) => g.id !== guest_id);
  map[team_id] = next;
  writeMap(map);
  return next;
}

/** The id used for a 直连模型专家 option/guest — one per (provider, model). */
export function modelExpertId(provider_id: string, model_name: string): string {
  return `model:${provider_id}:${model_name}`;
}

/**
 * Build selectable "直连模型专家" options from the configured providers (which
 * include the user's SiliconFlow / 国产模型). Each enabled model becomes one
 * aionrs-backed expert the boss can seat at the table.
 */
export function buildModelExpertOptions(
  providers: IProvider[],
  getAvailableModels: (p: IProvider) => string[]
): TeamAgentOption[] {
  const out: TeamAgentOption[] = [];
  for (const provider of providers) {
    for (const model of getAvailableModels(provider)) {
      out.push({
        id: modelExpertId(provider.id, model),
        name: model,
        backend: 'aionrs',
        team_capable: false,
        provider_id: provider.id,
        model_name: model,
        isModelExpert: true,
      });
    }
  }
  return out;
}

/** Map a selectable option (backend extra OR 直连模型专家) to its persisted guest. */
export function optionToGuest(a: TeamAgentOption): MeetingGuest {
  if (a.provider_id && a.model_name) {
    return {
      id: a.id,
      agent_type: 'aionrs',
      agent_name: a.name,
      icon: a.icon,
      provider_id: a.provider_id,
      model_name: a.model_name,
    };
  }
  const id = a.backend ?? a.id;
  return { id, agent_type: a.backend ?? a.id, agent_name: a.name, icon: a.icon };
}

/** The guest id an option would produce (without persisting) — for selected-state checks. */
export function optionGuestId(a: TeamAgentOption): string {
  return a.provider_id && a.model_name ? a.id : (a.backend ?? a.id);
}
