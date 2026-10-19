import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Page, Card, Button } from "../components/ui/index.js";
import { AnalysisReview } from "./AnalysisGame.js";
import { PGN_STORAGE_KEY, parsePgnGame } from "../lib/analysis/pgn.js";

/** Engine review of a pasted PGN, at /analysis/pgn. */
export function AnalysisPgn() {
  const game = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(PGN_STORAGE_KEY);
      return raw ? parsePgnGame(raw) : null;
    } catch {
      return null;
    }
  }, []);

  if (!game) {
    return (
      <Page title="PGN analysis" back="/analysis">
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-base-content/60">
              There's no PGN to analyze. Paste one on the Analysis page.
            </p>
            <Link to="/analysis">
              <Button variant="glass" size="sm">
                Back to Analysis
              </Button>
            </Link>
          </div>
        </Card>
      </Page>
    );
  }
  return <AnalysisReview key={game._id} game={game} />;
}
