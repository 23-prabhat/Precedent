# Backtest your last six months

Precedent is an incident-memory layer for platform and SRE teams. The buyer is the head of platform or reliability. The user is the on-call engineer looking for a useful earlier fix during triage.

## Two-week pilot

**Week 1.** Run a time-ordered backtest on six months of the customer's incident history. Review three representative incidents with responders. Report the share with a useful precedent available at the time and how retrieval changed as confirmed links accumulated.

**Week 2.** Use one service and one on-call channel. Ask responders to confirm whether a surfaced precedent helped and measure time to the first correct hypothesis against their own baseline. Agree on minimum usefulness and coverage before the pilot.

The public precedent base gives a new team material to explore. Private incident data would live in a separately configured HydraDB database with customer-scoped access. The current demo is a single workspace.

## Commercial hypothesis

The public base and initial backtest are free. Test per-service or per-seat pricing for private memory and integrations. Distribution begins with design partners and a backtest their responders can verify.

Estimate annual diagnostic time saved as `12 × incidents per month × responder hours per incident × useful precedent rate × diagnosis time saved fraction`. Measure precedent rate in the backtest. Ask the customer for the first two inputs and validate the final fraction during the pilot.
