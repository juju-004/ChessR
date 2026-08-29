import { Link } from "react-router-dom";
import {
  usernameOf,
  gradientOf,
  type Tournament,
  type TournamentPairing,
} from "../../api/tournaments.js";
import { Card, CardHeader, CardTitle, Avatar } from "../ui/index.js";

export function roundLabel(
  indexFromStart: number,
  totalRounds: number,
): string {
  const fromEnd = totalRounds - indexFromStart;
  if (fromEnd === 1) return "Final";
  if (fromEnd === 2) return "Semi-finals";
  if (fromEnd === 3) return "Quarter-finals";
  return `Round ${indexFromStart + 1}`;
}

function MatchCard({
  tournament,
  pairing,
  myId,
}: {
  tournament: Tournament;
  pairing: TournamentPairing;
  myId?: string;
}) {
  const p1Name = usernameOf(tournament, pairing.player1);
  const p2Name = usernameOf(tournament, pairing.player2);
  const involvesMe = pairing.player1 === myId || pairing.player2 === myId;
  const p1Won = pairing.status === "finished" && pairing.result === "p1";
  const p2Won = pairing.status === "finished" && pairing.result === "p2";

  function slot(name: string, userId: string | null, won: boolean) {
    return (
      <div
        className={`flex items-center gap-1.5 truncate px-2 py-1.5 text-xs ${
          won ? "font-semibold text-base-content" : "text-base-content/70"
        }`}
      >
        <Avatar
          username={name}
          gradient={gradientOf(tournament, userId)}
          size="xs"
        />
        <span className="truncate">{name}</span>
        {won && <span className="ml-auto shrink-0 text-(--primary)">✓</span>}
      </div>
    );
  }

  const card = (
    <div
      className={`w-44 shrink-0 divide-y divide-base-300/60 rounded-lg border text-sm transition-colors ${
        involvesMe
          ? "border-(--secondary)/40 bg-(--secondary)/10"
          : "border-base-300 bg-base-100/60"
      } ${pairing.joinCode ? "hover:border-(--primary)/40" : ""}`}
    >
      {slot(p1Name, pairing.player1, p1Won)}
      {pairing.player2 !== null ? (
        slot(p2Name, pairing.player2, p2Won)
      ) : (
        <div className="px-2 py-1.5 text-xs text-base-content/40">Bye</div>
      )}
    </div>
  );

  if (pairing.joinCode) {
    return (
      <Link to={`/game/${pairing.joinCode}`} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

/** Tree-style bracket for knockout ('normal') tournaments, one column per
 *  round, with a short connector line off each match pointing toward the
 *  next round, plus a separate card for the 3rd-place match (if the
 *  organizer enabled one, see Tournament.thirdPlaceMatch) since it isn't
 *  part of the winner-advances chain the columns represent. Columns rely
 *  on flexbox's own equal-space distribution (justify-between, matching
 *  gap) rather than manually computed positions, since round N always has
 *  exactly half of round N-1's real matches, each later match naturally
 *  lands roughly between the two matches that feed it. */
export function KnockoutBracket({
  tournament,
  myId,
}: {
  tournament: Tournament;
  myId?: string;
}) {
  // The 3rd-place pairing (if any) isn't part of the bracket's
  // winner-advances chain, pull it out and render it separately below.
  const bracketRounds = tournament.rounds
    .map((r) => r.pairings.filter((p) => !p.isThirdPlace))
    .filter((pairings) => pairings.length > 0);
  const thirdPlacePairing = tournament.rounds
    .flatMap((r) => r.pairings)
    .find((p) => p.isThirdPlace);

  if (bracketRounds.length === 0) return null;

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>Bracket</CardTitle>
      </CardHeader>

      {tournament.status === "finished" && tournament.winner && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/70">
          <span>
            🏆{" "}
            <span className="font-medium text-base-content">
              {usernameOf(tournament, tournament.winner)}
            </span>
          </span>
          {tournament.runnerUp && (
            <span>🥈 {usernameOf(tournament, tournament.runnerUp)}</span>
          )}
          {tournament.thirdPlace && (
            <span>🥉 {usernameOf(tournament, tournament.thirdPlace)}</span>
          )}
          {tournament.fourthPlace && (
            <span className="text-base-content/50">
              4th {usernameOf(tournament, tournament.fourthPlace)}
            </span>
          )}
        </div>
      )}

      <div className="-mx-1 flex items-stretch gap-8 overflow-x-auto px-1 pb-2">
        {bracketRounds.map((matches, ri) => (
          <div key={ri} className="flex shrink-0 flex-col">
            <p className="mb-2 text-center text-xs font-medium tracking-wide text-base-content/40 uppercase">
              {roundLabel(ri, bracketRounds.length)}
            </p>
            <div className="flex flex-1 flex-col justify-around gap-6">
              {matches.map((m) => (
                <div key={m.index} className="relative">
                  <MatchCard tournament={tournament} pairing={m} myId={myId} />
                  {ri < bracketRounds.length - 1 && (
                    <span className="absolute top-1/2 -right-5 h-px w-5 bg-base-300" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {thirdPlacePairing && (
        <div className="mt-3 border-t border-base-300 pt-3">
          <p className="mb-2 text-center text-xs font-medium tracking-wide text-base-content/40 uppercase">
            3rd place
          </p>
          <div className="flex justify-center">
            <MatchCard
              tournament={tournament}
              pairing={thirdPlacePairing}
              myId={myId}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
