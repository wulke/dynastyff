import { memo, useEffect, useMemo, useState } from 'react';

import type { DraftState } from '../context/DraftContext.js';
import { getPositionBadgeClass } from './positionBadge.js';

type TeamRosterPanelProps = {
  draftState: DraftState;
};

type TeamRosterEntry = {
  pickNumber: number;
  roundLabel: string;
  pickLabel: string;
  playerName: string;
  position: string;
  dynastyValueLabel: string;
};

// @spec DFF-UI-188
function getDefaultSelectedTeamId(draftState: DraftState): string {
  return draftState.teams.find((team) => team.isUser)?.id ?? draftState.teams[0]?.id ?? '';
}

// @spec DFF-UI-189
function getPickLabel(draftState: DraftState, pickNumber: number): { roundLabel: string; pickLabel: string } {
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber) ?? null;

  if (!slot) {
    return {
      roundLabel: '—',
      pickLabel: '—',
    };
  }

  return {
    roundLabel: String(slot.round),
    pickLabel: `${slot.round}.${String(slot.pickInRound).padStart(2, '0')}`,
  };
}

// @spec DFF-UI-189
function getTeamRosterEntries(draftState: DraftState, selectedTeamId: string): TeamRosterEntry[] {
  return draftState.picks
    .filter((pick) => pick.teamId === selectedTeamId)
    .sort((left, right) => left.pickNumber - right.pickNumber)
    .map((pick) => {
      const player = draftState.playerCatalog[pick.playerId];
      const pickLabel = getPickLabel(draftState, pick.pickNumber);

      return {
        pickNumber: pick.pickNumber,
        roundLabel: pickLabel.roundLabel,
        pickLabel: pickLabel.pickLabel,
        playerName: player?.name ?? pick.playerId,
        position: player?.position ?? '—',
        dynastyValueLabel: typeof player?.dynastyValue === 'number' ? String(player.dynastyValue) : '—',
      };
    });
}

// @spec DFF-UI-187
// @spec DFF-UI-188
// @spec DFF-UI-189
// @spec DFF-UI-190
function TeamRosterPanelInner({ draftState }: TeamRosterPanelProps) {
  const [selectedTeamId, setSelectedTeamId] = useState(() => getDefaultSelectedTeamId(draftState));

  useEffect(() => {
    if (selectedTeamId && draftState.teams.some((team) => team.id === selectedTeamId)) {
      return;
    }

    setSelectedTeamId(getDefaultSelectedTeamId(draftState));
  }, [draftState.teams, selectedTeamId]);

  // @spec DFF-UI-188
  const teamOptions = useMemo(
    () =>
      draftState.teams.map((team) => ({
        id: team.id,
        name: team.name,
      })),
    [draftState.teams],
  );

  // @spec DFF-UI-189
  const rosterEntries = useMemo(
    () => getTeamRosterEntries(draftState, selectedTeamId),
    [draftState, selectedTeamId],
  );

  return (
    <section
      data-testid="team-roster-panel"
      className="flex h-full w-full min-h-0 flex-col rounded-md border border-default bg-surface"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-default px-3 py-2">
        <div>
          <h2 className="font-condensed text-lg font-semibold text-primary">Roster</h2>
          <p className="text-xs text-muted">Single-team draft log</p>
        </div>
        <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-muted">
          Team
          <select
            aria-label="Team"
            value={selectedTeamId}
            onChange={(event) => {
              setSelectedTeamId(event.target.value);
            }}
            className="rounded border border-default bg-app px-2 py-1.5 text-sm font-medium text-primary outline-none transition focus:border-strong"
          >
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {rosterEntries.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted">No picks yet</p>
          </div>
        ) : (
          <ol className="space-y-1">
            {rosterEntries.map((entry) => (
              <li
                key={entry.pickNumber}
                data-testid={`team-roster-entry-${entry.pickNumber}`}
                className="grid grid-cols-[3rem_4rem_minmax(0,1fr)_3rem_4rem] items-center gap-2 rounded border border-default bg-app px-2 py-1 text-sm"
              >
                <span className="font-condensed text-xs font-semibold text-muted tabular-nums">{entry.roundLabel}</span>
                <span className="font-condensed text-sm font-semibold text-secondary tabular-nums">{entry.pickLabel}</span>
                <span className="truncate font-medium text-primary">{entry.playerName}</span>
                <span className={getPositionBadgeClass(entry.position)}>{entry.position}</span>
                <span className="text-right text-sm font-medium text-secondary tabular-nums">
                  {entry.dynastyValueLabel}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// @spec DFF-UI-187
// @spec DFF-UI-188
// @spec DFF-UI-189
// @spec DFF-UI-190
export const TeamRosterPanel = memo(TeamRosterPanelInner);
