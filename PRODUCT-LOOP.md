# The Unignorable loop

## Mission

Make recurring civic conditions knowable early, publicly accountable, and measurably more likely to be resolved.

Unignorable is not a walking app, a complaint map, or a campaign toolkit. Its atomic object is one approximate block-level **Condition** moving through four visible states:

1. **Detected** — public evidence supports a versioned, dated estimate.
2. **Checked** — a nearby person submits a proximity-checked observation; review governs whether it becomes learning evidence.
3. **Action** — a permanent record names the responsible office, exposes impact, prepares the next escalation, and issues receipts.
4. **Outcome** — people confirm what changed and whether it held; recurrence reopens the loop.

In the September 5 record slice, Checked requires an approved proximity check; pending observations and legacy one-tap corroboration cannot advance it. Held additionally requires reviewed presence before the clear claim, reviewed absence on at least two distinct later days, an absence check at or beyond the required quiet-window endpoint, and no contradiction. Independence of observers remains a manual pilot check; deduplication hashes are not identities. See [PRODUCTION-DIRECTION.md](./PRODUCTION-DIRECTION.md) for the current audience and measured canary, which supersede historical expansion proposals below.

Walking routes recruit useful checks. Share receipts recruit checkers and actors. Campaigns produce action. City-specific remedies plug into the Action state. None is a separate product.

## Objective function

Primary: **verified resolved condition-days per active block**.

A condition counts only after the product has both a reviewed prior presence signal and a later reviewed outcome signal. A durable outcome accrues days until recurrence. Severity, access impact, and sensitive-site proximity may prioritize work, but cannot substitute for verification.

Supporting measures:

- Forecast: calibration, false-positive rate, useful recall under a fixed field-check budget, spatial error, and evidence freshness.
- Evidence: requested-check completion, review acceptance rate, sampling balance across predicted-present and predicted-absent places, and median review time.
- Action: checked-to-action conversion, tracked actions per active campaign, official response time, and action-to-outcome time.
- Outcome: 7/30/60-day confirmed durability and recurrence rate.
- Growth: receipt viewer → nearby checker or actor conversion. Shares without a useful downstream transition are not a win.

Guardrails: never identify or characterize a person; never turn an unreviewed submission into model truth; never imply false location precision; never pay for a report; never auto-send an external message; never optimize outrage independently of resolution.

## Why this can compound

The smallest self-sustaining network is one block with three roles: a nearby checker, an affected resident or owner, and the accountable public office. Better evidence makes the receipt more credible. A credible receipt recruits more checks and action. More reviewed outcomes create the labeled data needed to improve the next model version. Better forecasts make each future check request more useful.

The share artifact is not “look at our app.” It is a block's unfinished public record with an obvious next move. The sender shares because the condition affects them; the recipient can contribute without first understanding the whole product.

## Product rules

- Show one current state and one next useful action.
- Keep the system state visible; never hide the forecast, review status, action receipts, or outcome behind unrelated modes.
- Treat model sophistication as downstream of label quality. Add deeper learning only when reviewed field observations can evaluate it out of sample.
- Use public closures as claims, not outcomes. A durable outcome requires a later community or agency observation that survives review.
- Let each jurisdiction supply source adapters, accountable offices, escalation ladders, and remedies while preserving the same Condition state machine.

## Atlanta

Georgia HB 295 is an Action-stage remedy for a qualifying real-property owner who documents covered non-enforcement or nuisance-related loss. It is not a reporter reward. The Atlanta adapter should organize owner, parcel, chronology, causation, expense or valuation, timing, and attorney-review evidence only after a current authoritative ATL311 feed is obtained.

A future community-funded resolution pledge is a separate experiment. It must reward independently verified resolution—not reporting—and needs funding, anti-self-dealing, dispute, hold-period, and release rules before it appears as enabled product functionality.

## Canary that can disprove the thesis

Run one NYC block end to end before broadening categories or cities.

- At least 20 qualified forecast viewers.
- At least 5 nearby checks, including explicit “absent” or “uncertain” sampling rather than only confirmations.
- Review every check within 24 hours.
- At least 3 checked viewers complete a tracked accountability action.
- Obtain an official response or documented escalation within 14 days.
- Require reviewed outcome checks at 7, 30, and 60 days.

If people will share but will not check or act, the artifact is outrage content, not the product. If checks arrive but cannot improve calibration, the prediction claim is premature. If actions occur but no outcome can be verified, the accountability workflow—not another growth feature—is the bottleneck.

## Teek critique synthesis

The profile jam was used as a set of falsifiable critique lenses, not simulated authority:

- Growth: the loop must recruit the next checker or actor as a consequence of normal use; a share button alone is not virality.
- Craft: storyboard one block's end-to-end transition and remove every surface that does not advance it.
- Visibility: make the current state, evidence provenance, and next transition immediately legible.
- Durability: prove retention, economics, and outcome quality on one block before claiming a citywide network.
- Operations: win one city with an explicit source, review, escalation, and outcome operation before expanding.
