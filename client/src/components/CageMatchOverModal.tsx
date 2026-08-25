import { memo } from "react";
import { Trophy, Frown, Handshake } from 'lucide-react';
import { Card, Button } from './ui/index.js';
import { computeCageStandings, type CageMatch } from '../api/cageMatches.js';

interface CageMatchOverModalProps {
  match: CageMatch;
  myUserId?: string;
  onViewResult: () => void;
  onClose: () => void;
}

function reasonText(reason: CageMatch['matchEndReason']): string {
  if (reason === 'no_show_forfeit') return "Ended: someone didn't move in time at the start of a game.";
  if (reason === 'forfeit') return 'Ended by forfeit.';
  return 'All games complete.';
}

export const CageMatchOverModal = memo(function CageMatchOverModal({ match, myUserId, onViewResult, onClose }: CageMatchOverModalProps) {
  const iAmP1 = match.player1._id === myUserId;
  const me = iAmP1 ? match.player1 : match.player2;
  const opponent = iAmP1 ? match.player2 : match.player1;
  const standings = computeCageStandings(match);
  const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
  const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;

  const isDraw = match.matchWinner === 'draw';
  const winnerIsMe = (match.matchWinner === 'p1' && iAmP1) || (match.matchWinner === 'p2' && !iAmP1);

  const title = isDraw ? 'Match Drawn' : winnerIsMe ? 'You Won the Match!' : 'You Lost the Match';
  const Icon = isDraw ? Handshake : winnerIsMe ? Trophy : Frown;

  let outcomeLine = '';
  if (!isDraw) {
    if (match.matchEndReason === 'no_show_forfeit') {
      const loserLabel = winnerIsMe ? opponent.username : 'You';
      outcomeLine = `${loserLabel} didn't move in time at the start of a game.`;
    } else if (match.forfeitedBy) {
      outcomeLine = `${match.forfeitedBy === me._id ? 'You' : opponent.username} forfeited the match.`;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <Card
        variant="strong"
        className="relative w-full max-w-sm text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-base-content/50 hover:text-base-content/80"
        >
          ✕
        </button>

        <div
          className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full ${
            isDraw
              ? 'gradient-brand text-white'
              : winnerIsMe
                ? 'bg-green-500/15 text-green-400'
                : 'bg-red-500/15 text-red-400'
          }`}
        >
          <Icon className="h-7 w-7" />
        </div>

        <h2
          className={`mb-1 text-2xl font-bold ${
            isDraw ? 'text-base-content' : winnerIsMe ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {title}
        </h2>

        <p className="mb-1 text-sm text-base-content/60">vs {opponent.username}</p>

        <div className="mx-auto mb-3 mt-2 flex items-center justify-center gap-6 rounded-xl bg-base-100/60 py-3">
          <div className="text-center">
            <p className="text-xs text-base-content/50">You</p>
            <p className="text-xl font-bold text-base-content">{myScore}</p>
          </div>
          <span className="text-base-content/40">–</span>
          <div className="text-center">
            <p className="text-xs text-base-content/50">{opponent.username}</p>
            <p className="text-xl font-bold text-base-content">{oppScore}</p>
          </div>
        </div>

        <p className="mb-5 text-sm text-base-content/60">{outcomeLine || reasonText(match.matchEndReason)}</p>

        <div className="flex flex-col gap-2">
          <Button onClick={onViewResult} fullWidth>
            View result
          </Button>
          <Button variant="glass" onClick={onClose} fullWidth>
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
})
