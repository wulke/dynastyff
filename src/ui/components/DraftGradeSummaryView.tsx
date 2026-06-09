// @spec DFF-UI-145
// @spec DFF-UI-146
// @spec DFF-UI-147
// @spec DFF-UI-148
// @spec DFF-UI-149
// @spec DFF-GRADE-003
// @spec DFF-GRADE-040
// @spec DFF-GRADE-041
import { useMemo } from 'react';

import type { DraftState } from '../context/DraftContext.js';
import { calculateDraftGradeSummaries, type DraftGradeSummaryInput } from '../../draft/grade-summary.js';

type DraftGradeSummaryViewProps = {
  draftState: DraftState;
  onNewDraft: () => void;
  onViewHistory: () => void;
};

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'] as const;
type Position = (typeof POSITION_ORDER)[number];

type RosterPlayerSummary = {
  playerId: string;
  name: string;
  round: number;
  value: number;
};

// @spec DFF-GRADE-003
function buildGradeSummaryInput(draftState: DraftState): DraftGradeSummaryInput | null {
  if (draftState.status !== 'completed' || !draftState.rosterConfig) {
    return null;
  }

  return {
    status: 'completed',
    rosterConfig: draftState.rosterConfig,
    teams: draftState.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isUser: team.isUser,
    })),
    draftOrder: draftState.draftOrder.map((slot) => ({
      pickNumber: slot.pickNumber,
      teamId: slot.teamId,
    })),
    picks: draftState.picks.map((pick) => ({
      pickNumber: pick.pickNumber,
      teamId: pick.teamId,
      playerId: pick.playerId,
    })),
    rosterPlayers: draftState.rosterPlayers.map((entry) => ({
      teamId: entry.teamId,
      playerId: entry.playerId,
    })),
    playerCatalog: Object.fromEntries(
      Object.entries(draftState.playerCatalog).map(([playerId, player]) => [
        playerId,
        {
          id: player.id,
          name: player.name,
          position: player.position,
          dynastyValue: player.dynastyValue,
          adp: player.adp,
        },
      ]),
    ),
  };
}

function formatGradeScore(score: number, letterGrade: string): string {
  return `${score} · ${letterGrade}`;
}

function formatDynastyValue(value: number): string {
  return value.toLocaleString('en-US');
}

function getPickRound(draftState: DraftState, playerId: string): number {
  const pick = draftState.picks.find((entry) => entry.playerId === playerId);
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pick?.pickNumber);
  return slot?.round ?? 0;
}

function buildRosterGroups(draftState: DraftState, teamId: string): Record<Position, RosterPlayerSummary[]> {
  const grouped = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  } as Record<Position, RosterPlayerSummary[]>;

  for (const rosterPlayer of draftState.rosterPlayers) {
    if (rosterPlayer.teamId !== teamId) {
      continue;
    }

    const player = draftState.playerCatalog[rosterPlayer.playerId];
    const position = player?.position as Position | undefined;

    if (!position || !POSITION_ORDER.includes(position)) {
      continue;
    }

    grouped[position].push({
      playerId: rosterPlayer.playerId,
      name: player?.name ?? rosterPlayer.playerId,
      round: getPickRound(draftState, rosterPlayer.playerId),
      value: player?.dynastyValue ?? 0,
    });
  }

  for (const position of POSITION_ORDER) {
    grouped[position].sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }

      return left.round - right.round;
    });
  }

  return grouped;
}

// @spec DFF-UI-145
// @spec DFF-UI-146
// @spec DFF-UI-147
// @spec DFF-UI-148
// @spec DFF-UI-149
// @spec DFF-GRADE-003
// @spec DFF-GRADE-040
// @spec DFF-GRADE-041
export function DraftGradeSummaryView({ draftState, onNewDraft, onViewHistory }: DraftGradeSummaryViewProps) {
  const summary = useMemo(() => {
    const input = buildGradeSummaryInput(draftState);
    return input ? calculateDraftGradeSummaries(input) : null;
  }, [draftState]);

  const userTeam = summary?.teamSummaries.find((team) => team.isUser) ?? summary?.teamSummaries[0] ?? null;
  const rosterGroups = useMemo(
    () => (userTeam ? buildRosterGroups(draftState, userTeam.teamId) : null),
    [draftState, userTeam],
  );

  if (!summary || !userTeam || !rosterGroups) {
    return (
      <section className="w-full max-w-6xl rounded-md border border-default bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Post-Draft</p>
            <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Draft Grade Summary</h1>
            <p className="text-xs text-muted">This draft does not have enough completed data to render the grade summary.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onViewHistory}
              className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-strong hover:text-secondary"
            >
              View Full History
            </button>
            <button
              type="button"
              onClick={onNewDraft}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
            >
              New Draft
            </button>
          </div>
        </div>
      </section>
    );
  }

  const dimensionOrder = [
    userTeam.dimensions.valueOverExpectedAdp,
    userTeam.dimensions.positionalBalance,
    userTeam.dimensions.rosterConstruction,
  ];

  return (
    <section className="w-full max-w-6xl rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Post-Draft</p>
          <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Draft Grade Summary</h1>
          <p className="text-xs text-muted">
            Completed draft review using the deterministic grade rubric and your final roster.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onViewHistory}
            className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-strong hover:text-secondary"
          >
            View Full History
          </button>
          <button
            type="button"
            onClick={onNewDraft}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
          >
            New Draft
          </button>
        </div>
      </div>

      <div className="border-b border-default px-4 py-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
          <section className="rounded-md border border-accent bg-accent/10 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Overall Grade</p>
            <h2 className="mt-2 font-condensed text-xl font-bold text-primary">{userTeam.teamName}</h2>
            <p className="mt-4 font-condensed text-5xl font-bold tabular-nums text-primary">
              {userTeam.letterGrade}
            </p>
            <p className="mt-2 font-condensed text-lg font-semibold tabular-nums text-secondary">
              {userTeam.overallScore} / 100
            </p>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Room Results</p>
            <div data-testid="grade-summary-leaderboard" className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {summary.teamSummaries.map((team) => (
                <article
                  key={team.teamId}
                  data-testid={`grade-summary-team-${team.teamId}`}
                  data-user-team={team.isUser ? 'true' : 'false'}
                  className={`rounded-md border px-3 py-3 ${
                    team.isUser ? 'border-accent bg-accent/10' : 'border-default bg-app'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-condensed text-sm font-semibold text-primary">{team.teamName}</p>
                      <p className="text-[0.65rem] uppercase tracking-widest text-muted">
                        {team.isUser ? 'Your Team' : 'Draft Grade'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-condensed text-lg font-bold tabular-nums text-primary">
                        {formatGradeScore(team.overallScore, team.letterGrade)}
                      </p>
                      <p className="text-[0.65rem] uppercase tracking-widest text-muted">Overall</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-md border border-default bg-app px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Rubric Breakdown</p>
              <h2 className="font-condensed text-lg font-bold text-primary">Overall Grade</h2>
            </div>
            <p className="font-condensed text-2xl font-bold tabular-nums text-primary">
              {formatGradeScore(userTeam.overallScore, userTeam.letterGrade)}
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {dimensionOrder.map((dimension) => (
              <div key={dimension.key} className="rounded border border-default bg-surface px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-condensed text-sm font-semibold text-primary">{dimension.label}</p>
                  <p className="font-condensed text-sm font-bold tabular-nums text-primary">{dimension.score}</p>
                </div>
                <p className="mt-1 text-xs text-muted">{dimension.summary}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-default bg-app px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your Team</p>
          <h2 className="font-condensed text-lg font-bold text-primary">Final Roster</h2>
          <div data-testid="grade-summary-final-roster" className="mt-4 space-y-2">
            {POSITION_ORDER.map((position) => {
              const players = rosterGroups[position];

              return (
                <div key={position} className="rounded border border-default bg-surface px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-condensed text-sm font-semibold text-primary">{position}</p>
                    <p className="text-[0.65rem] uppercase tracking-widest text-muted">
                      {players.length} player{players.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {players.length === 0 ? (
                    <p className="mt-2 text-xs italic text-muted">—</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {players.map((player) => (
                        <div key={player.playerId} className="flex items-center justify-between gap-3">
                          <span className="text-xs text-secondary">{player.name}</span>
                          <div className="flex items-center gap-2 text-[0.65rem] tabular-nums text-muted">
                            <span>Rd {player.round}</span>
                            <span>{formatDynastyValue(player.value)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
