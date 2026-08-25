import { Link } from "react-router-dom";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";

interface Section {
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: "1. Acceptance of terms",
    body: (
      <>
        By creating an account on Chessr, you agree to these Terms of
        Service. If you don't agree with any part of them, please don't use
        the platform.
      </>
    ),
  },
  {
    title: "2. Eligibility",
    body: (
      <>
        You must be at least 18 years old, or the age of legal majority in
        your jurisdiction (whichever is higher), to create an account or
        take part in any wagered game, cage match, or tournament. Chessr
        involves staking and winning real-money-backed R Coins, and it's
        your responsibility to confirm that participating is lawful where
        you live before you fund an account.
      </>
    ),
  },
  {
    title: "3. Your account",
    body: (
      <>
        You're responsible for keeping your login credentials secure and for
        all activity that happens under your account. One account per
        person, creating multiple accounts to evade a report, a
        withdrawal block, or matchmaking is a violation of these terms and
        may result in suspension.
      </>
    ),
  },
  {
    title: "4. R Coins, deposits, and withdrawals",
    body: (
      <>
        R Coins are the platform's in-app currency, purchased with real
        money via Paystack and used to fund wagers, cage matches, and
        tournament entries. R Coins have no value outside the platform other
        than through a withdrawal.
        <br />
        <br />
        Withdrawals convert your R Coin balance back to Naira at the rate in
        effect at the time of the request, subject to a minimum withdrawal
        amount shown on the withdrawal page. We reserve the right to pause
        withdrawals on an account under active review, for example, one
        that's the subject of an open cheating or misconduct report, until
        that review is complete.
      </>
    ),
  },
  {
    title: "5. Wagers, the pot, and the platform fee (\u201crake\u201d)",
    body: (
      <>
        Games, cage matches, and tournaments on Chessr are played for R Coin
        stakes rather than a traditional rating. When you create or accept a
        wagered game, both players stake the agreed number of R Coins into
        the game's pot up front; in a tournament, your entry fee joins a
        shared prize pool instead.
        <br />
        <br />
        When a wagered pot settles, Chessr deducts a platform fee, a
        percentage of the gross pot, referred to on the platform and in
        this document as the <strong>rake</strong>, before the remainder
        is paid out to the winner(s). The rake percentage is fixed at the
        moment a pot settles and displayed to you before you confirm a
        wager, so what you see when you set up a game is what applies to
        it, even if the platform-wide rate changes afterward. The rake is
        rounded down, never up, so it can never exceed the displayed rate
        on a given pot.
        <br />
        <br />
        The rake applies uniformly across every settlement path on the
        platform: standard wagered games, cage match legs, and tournament
        prize pools. Every rake deduction is recorded on an internal
        revenue ledger for audit purposes; Chessr does not maintain a
        "house" player account that participates in games.
        <br />
        <br />
        Wagers are compulsory on games, cage matches, and tournament entry, there's no free-play mode. Once a wager is staked into a pot, it
        is held in escrow until the game, leg, or tournament concludes and
        is only released as part of a settlement (a win, a loss, a draw
        split, or an agreed cancellation before the game starts).
      </>
    ),
  },
  {
    title: "6. Fair play",
    body: (
      <>
        All moves are validated server-side, and games are subject to
        automated anti-cheat review. If you believe an opponent cheated,
        harassed you, or otherwise broke these terms, you can report them
        from their profile or from the game itself. Reports are reviewed by
        our team, and accounts found to be cheating, sandbagging,
        colluding, or abusing multiple accounts may have their withdrawals
        blocked, their wagers forfeited, or their account suspended,
        depending on severity.
      </>
    ),
  },
  {
    title: "7. Prohibited conduct",
    body: (
      <>
        In addition to cheating and multi-accounting, you agree not to:
        harass, threaten, or abuse other players; attempt to manipulate
        matchmaking or ratings; use bots, engines, or other move-assistance
        tools during a rated or wagered game; exploit bugs for financial
        gain rather than reporting them; or use the platform for money
        laundering or any other unlawful purpose.
      </>
    ),
  },
  {
    title: "8. Disputes and liability",
    body: (
      <>
        Chessr's game record, moves, clocks, and final result as stored on
        our servers, is the authoritative record for settling any dispute
        about a game's outcome. We provide the platform "as is" and aren't
        liable for losses arising from wagers you choose to enter,
        connectivity issues on your end, or funds lost to your own account
        security lapses.
      </>
    ),
  },
  {
    title: "9. Changes to these terms",
    body: (
      <>
        We may update these terms from time to time as the platform
        evolves. Continuing to use Chessr after a change takes effect means
        you accept the updated terms. Material changes to the rake rate or
        withdrawal terms will be reflected here.
      </>
    ),
  },
  {
    title: "10. Contact",
    body: (
      <>
        Questions about these terms, a wager, or a report can be raised
        through the in-app report flow or your account settings.
      </>
    ),
  },
];

export function Terms() {
  return (
    <Page
      title="Terms of Service"
      description="Please read these terms carefully before using Chessr."
      back
    >
      <div className="space-y-4">
        <Card variant="solid">
          <p className="text-sm text-base-content/70">
            These terms govern your use of Chessr, including wagered games,
            cage matches, and tournaments. See also our{" "}
            <Link to="/about" className="text-(--primary) hover:underline">
              About page
            </Link>{" "}
            for a general overview of the platform.
          </p>
        </Card>

        {SECTIONS.map((s) => (
          <Card key={s.title} variant="solid">
            <h2 className="mb-2 text-sm font-semibold text-base-content">
              {s.title}
            </h2>
            <p className="text-sm leading-relaxed text-base-content/70">
              {s.body}
            </p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
