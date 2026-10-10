# Research: How dynasty tools model trade fairness and counterparty acceptance

> **Ticket:** [#212: How do existing dynasty tools model trade fairness and acceptance?](https://github.com/wulke/dynastyff/issues/212)
> **Parent map:** [#210: Realistic, counterparty-aware trades](https://github.com/wulke/dynastyff/issues/210)
> **Captured:** 2026-10-10 · branch `research/trade-fairness-models`
> **Purpose:** Find out how established tools decide that a trade is "fair", how they discount multi-asset packages, and whether they look at the other team's roster or situation. The recommender in `src/season/tradeRecommender.ts` currently scores trades only from the user's side, which is how it ends up suggesting Aaron Rodgers for a 2027 1st.

## How to read this document

| Tag | Meaning |
|---|---|
| **[SRC]** | Read directly from the tool's shipped source: minified production JS fetched on 2026-10-10, or a public GitHub repo at the commit noted. The formulas are transcribed from that code. |
| **[RUN]** | Numbers produced by running the tool's own extracted functions (KTC) or by evaluating its formula by hand (others) on made-up inputs. These are not screenshots of the live UI. |
| **[DOCS]** | Stated in the tool's own FAQ or UI copy. |
| **[INFERRED]** | My interpretation. It is not stated by the tool and has not been verified. |

Minified JS changes on every deploy. The file names and hashes below are the ones fetched on the capture date, so the variable names in the quoted snippets (`e`, `a`, `t` and so on) are minifier output.

---

## 1. KeepTradeCut (KTC) trade calculator

Sources: page `https://keeptradecut.com/trade-calculator`, script `https://keeptradecut.com/js/site.min.js?v=q_FrAXDmPCSBij8MDiPA1mxk_RQ17dn3TxS0QPcvRHk`, FAQ `https://keeptradecut.com/frequently-asked-questions?open=value-adj`.

### 1.1 What KTC says it does [DOCS]

From the FAQ ("What is the 'Value Adjustment'?"):

> "Trading is more than simple addition. We add value to the side of the trade that's giving up more when you look at roster spots, players' 'stud' factor, etc. This is our way of countering (as much as possible) trade calculations that say 12 third round picks are a fair deal for DeAndre Hopkins. The actual adjustment is reverse engineered from the player the lesser side needs to have added to even the trade…"

> "A few things are factored into the 'Value Adjustment' - the difference in value of the players involved, how much of a 'stud' the players involved are, the number of players of lesser value included in the trade... and a lil fancy math."

The FAQ also says the calculator is "at best a gut check… Every trade is unique to the specific owners involved, so all we can do is give the averages of how dynasty owners value players."

### 1.2 The formula [SRC]

`site.min.js` sets `var ALGOTOUSE=2`, so `evaluateTrade()` calls `adjustPackageNew()`. The older `adjustPackage()`/`processV()` path is dead code. Values are on KTC's 0–9,999 scale (`MAXPLAYERVAL=1e4`).

**Step 1: "processed" value of each asset.** Let `v` be the asset's value and `vmax` be the single most valuable asset in the whole trade, on either side:

```js
function processVNew(e,a,t){var r=a;return 1*(.1*Math.pow(e/10099,1.4)+.7*Math.pow(e/(1.05*r),1.25)+.2)*e}
```

which is

```
processed(v) = v · [ 0.1·(v/10099)^1.4 + 0.7·(v/(1.05·vmax))^1.25 + 0.2 ]
```

Each asset keeps between 20% and about 96% of its value, and the share depends on how close it is to the best asset in the deal. Multipliers computed from the formula (with `vmax` = 8000 for the right-hand column):

| v | processed/v when v is the top asset | processed/v when the top asset is 8000 |
|---|---|---|
| 9,999 | 0.957 | n/a |
| 8,000 | 0.931 | 0.931 |
| 6,000 | 0.907 | 0.708 |
| 4,000 | 0.886 | 0.504 |
| 2,000 | 0.869 | 0.327 |
| 1,000 | 0.863 | 0.253 |

A 4,000 piece next to an 8,000 stud therefore counts for about half its value. This is the consolidation, or "stud", premium.

**Step 2: sum each side and compare.** `rawAdj` is Σ processed values per side. The code then:

1. Takes `c = floor(|rawAdj1 − rawAdj2|)`, the gap in processed units.
2. Inverts the processed curve with Newton's method (`solveForX`, 20 iterations, tolerance 1e-8) to find the raw value `x` whose processed value equals `c`. This is the "player the lesser side needs to have added".
3. Sets the Value Adjustment to `otherSideRaw + x − thisSideRaw` and applies it to the side with the larger processed sum (the stud side). There are several branches depending on whether the raw totals and processed totals each pass the variance check.

**Step 3: fairness test.**

```js
var t=teamOne.totalValue+teamOne.adjust, r=teamTwo.totalValue+teamTwo.adjust;
var s=t+r, n=parseInt(tcFilters.variance), l=Math.abs(t-r), i=Math.min(100,l/s*100);
parseFloat(Math.round(10*i)/10)>n ? /* unfair */ : /* "Fair Trade" */
```

- **Fairness band:** `|A − B| / (A + B) × 100 ≤ variance`. The variance is the "Acceptable Variance" slider: `min=0 max=10 step=1 value=5`, tooltip *"The acceptable difference between sides (over total trade value)"*. The denominator is the sum of both sides, so the default 5% allows the larger side to be about 10.5% bigger than the smaller one (for example 1,000 vs 1,105).
- The adjustment block is only displayed when either side has more than one piece, and is hidden when `|adjustment| / (T1+T2) < 3.3%`. In both cases the adjustment is still added to the totals used by the fairness test.
- The "Future Pick Adjustment" slider (`min=-10 max=10`, default 0) scales every `RDP` (rookie draft pick) value by ±0–10% before any of the above (`value = initValue + initValue*pickVal/100`).

### 1.3 Worked examples [RUN]

I extracted `processVNew`, `solveForX`, `reverseAdjustNew`, `checkEquality` and `adjustPackageNew` from `site.min.js` and ran them unmodified in a Node `vm` sandbox. Settings: top player = 9,999, variance = 5.

| Side 1 | Side 2 | Raw totals | Value Adjustment (to side 1) | Adjusted totals | Diff/sum | Verdict |
|---|---|---|---|---|---|---|
| 7000 | 3500 + 3500 | 7000 / 7000 | +4,657 | 11,657 / 7,000 | 25.0% | unfair, favors side 1 |
| 7000 | 4000 + 3000 | 7000 / 7000 | +4,604 | 11,604 / 7,000 | 24.7% | unfair |
| 7000 | 3000 × 3 | 7000 / 9000 | +6,186 | 13,186 / 9,000 | 18.9% | unfair |
| 8000 | 700 × 12 | 8000 / 8400 | +7,249 | 15,249 / 8,400 | 29.0% | unfair |
| 9000 | 7000 + 2500 | 9000 / 9500 | +5,161 | 14,161 / 9,500 | 19.7% | unfair |
| 6000 | 6000 | equal | 0 | 6,000 / 6,000 | 0% | fair |
| 6000 | 5500 | 6000 / 5500 | +1,665 (not displayed, 1-for-1) | 7,665 / 5,500 | 16.4% | unfair |

Takeaway: the consolidation premium is large. For one 7,000 asset, two 3,500s are nowhere near enough; the other side needs to add roughly another 4,600. The 1-for-1 rows also show that the same math widens small raw gaps. **[CAUTION]** These results come from running the shipped functions in isolation and have not been compared with the rendered UI. Other page code could post-process the totals, but I did not find any that does.

### 1.4 Does KTC consider the other team? [SRC]

The calculator does not. Its only inputs are asset values, the variance and pick sliders, format (1QB or SF), TEP, and startup mode. The roster-aware tools (League Power Rankings) use a different weighting function, `prProcessVNew(value, slotAvg, max)`, which compares each player with the league-average value at the same roster slot. That function is used for team strength, not for trade acceptance.

---

## 2. FantasyCalc

Sources: SPA at `https://www.fantasycalc.com` (Angular). Calculator logic is in `https://www.fantasycalc.com/chunk-F4CNOEUX.js`, the Suggested Trades finder in `https://www.fantasycalc.com/chunk-E23XPBTX.js`, and the FAQ text in `https://www.fantasycalc.com/chunk-AMG5PCHG.js`. Public API: `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`.

### 2.1 Value scale [DOCS] [SRC]

> "FantasyCalc finds trade values from hundreds of thousands of real trades… Trade values are on an exponential curve, not linear. Extra value for top players is already baked into the model."

The live API on 2026-10-10 (SF, 12 teams, PPR) has its top asset at about 10,839 (Josh Allen). The 50th asset is about 3,779 and the 2028 1st is 2,248. Each row also has `redraftValue` and `redraftDynastyValueDifference`; the trade finder uses both.

### 2.2 Calculator "waiver adjustment" (package discount) [SRC] [DOCS]

FAQ: *"The calculator adds a small value for the bench or waiver player implied by uneven trades, and increases it with each extra roster spot lost. The model assumes roughly the 300th-best player is dropped to complete a 2-for-1."*

The trade-calculator component calls `tradeCalculatorService.getValueAdjustment(isDynasty, side1, side2)`:

```js
var re={pctFactor:.42,adjustmentFactor:550,adjustmentScalar:200},   // redraft (legacy path)
    Y ={pctFactor:.6982,adjustmentFactor:753,adjustmentScalar:.23}; // dynasty
getValueAdjustment(a,n,o){ if(n.length===o.length||n.length===0||o.length===0) return {side1Adj:0,side2Adj:0,…};
  if(!a) return this.getLegacyRedraftValueAdjustment(n,o);
  let {pctFactor:p,adjustmentFactor:m,adjustmentScalar:P}=Y,
      C=(u,w)=>u.slice().sort((S,L)=>S-L).slice(0,w).map((S,L)=>Math.min(S*p,m+L*P));
  if(n.length<o.length){ let u=C(o.map(S=>S.value),o.length-n.length); return {side1Adj: Σ floor(u), side2Adj:0, …} }
  …mirror… }
```

In words, for dynasty: let `k` be the difference in piece count. Take the `k` lowest-valued assets on the side with more pieces. Each one contributes `min(0.6982 · v_i, 753 + 0.23·i)`. The sum is credited to the side with fewer pieces. In practice that is a flat credit of about 753 per extra roster spot, roughly 7% of an elite asset. It does not scale with how good the stud is.

- **Example [RUN, by formula]:** one 7,000 player for 4,000 + 3,000. Side 1 gets min(3000·0.6982, 753) = +753, giving 7,753 vs 7,000.
- **Fairness band:** the calculator has no percentage band. It prints "Favors Players on Team One by N" or "This trade is perfectly fair" (exact equality only), suggests "Players To Equalize Trade", and warns *"Trade calculator is likely to be inaccurate when the difference in the number of players on each side >4"*.

So KTC's stud premium grows with the stud's value, while FantasyCalc's roster-spot credit is a flat ~753 per extra piece. FantasyCalc relies on its exponential value curve to supply the stud premium.

### 2.3 Suggested Trades: a counterparty-aware trade finder [SRC]

This is the most relevant prior art for us. Route `suggested-trades` (component `app-suggested-trades`); the logic runs client-side in `chunk-E23XPBTX.js`. UI defaults: `strategy=50` (slider labelled "(Rebuild ← → Contend)", range 0–100 step 10), `fairness=500` ("Dynasty fairness threshold (absolute value diff)", range 0–2000 step 100), `topK=5` per opponent, trade shapes `1x1, 1x2, 2x1, 2x2`.

The algorithm, transcribed from the code:

1. **Lineup-aware team value.** `le(players, rules, mode)` fills the league's actual starting slots (QB/RB/WR/TE counts, then FLEX from RB/WR/TE, then SUPERFLEX from QB/RB/WR/TE) greedily by value. Team value = Σ value of the **starters only**, computed separately with redraft values and dynasty values. Bench players add nothing.
2. **Targets on each opponent (`Ui`).** For every opponent player `u`, compute how much the user's starting lineup gains by adding `u`. `contendRatio = strategy/100`.
   - Contend (≥ 0.5): keep `u` if the redraft starter gain is > 0.
   - Rebuild (< 0.5): always keep picks. Keep a player only if `redraftValue − dynastyValue ≤ 800` (not a win-now-only asset) **and** the dynasty starter gain is > 0.
   - The top 12 are kept.
3. **What the opponent gives up alongside the target.** For each opponent player, `q[id]` = the drop in the opponent's own dynasty starting lineup if that player left. Filler assets from the opponent are drawn from the lowest `q` values, i.e. the players the opponent needs least: up to 14 players and 6 picks.
4. **What the user offers (`xo`).** Contend mode offers players whose dynasty value exceeds their redraft value (future value the contender can spare), the lowest redraft-value players, and up to 4 picks. Rebuild mode offers players whose redraft value exceeds their dynasty value, plus up to 6 picks.
5. **Hard fairness gate.** Apply the same dynasty waiver adjustment (`Qi`, same constants as 2.2) and reject the trade if `|(Σdv_out + adj) − (Σdv_in + adj)| > fairnessThresholdDv` (default **500 absolute dynasty value**). In contend mode, also reject when the user's redraft starter delta ≤ 0.
6. **Score (higher is better):**
   ```
   score = 1.0·ΔRedraftStarters(you) + 0.35·ΔDynastyStarters(you) + 0.4·ΔDynastyStarters(THEM)
         − 0.2·avg(q of what they give)            // penalize taking their starters
         − 0.0008·|dynasty diff|
         + max(0, 1 − contendRatio)·0.9·(Σdiff(myOut) − Σdiff(theirOut))   // rebuild: sell win-now value
         + 0.05·(mode-specific diff terms)
   ```
   where `diff = redraftValue − dynastyValue`. The `0.4·ΔDynastyStarters(THEM)` term rewards trades that also improve the opponent's starting lineup, and `−0.2·avg q` penalizes trades that take players the opponent starts.
7. **Diversity.** Results are deduplicated and capped at 3 per "what they give" key. All-pick returns are relabelled "Any Team". Each opponent's list is reranked by MMR (`0.7·score − 0.3·similarity`, using Jaccard similarity on asset sets plus a same-opponent and same-pick bonus), capped at `min(topK, 20)`, and opponents are interleaved with a per-opponent weight decay of ×0.6.

**What it does *not* model:** the opponent's contend/rebuild status. The strategy slider describes the **user's** strategy only. Opponent needs enter only through their starting-lineup delta (`ΔDynastyStarters(THEM)` and `q`). **[INFERRED]** A rebuilding opponent's interest in picks is not captured, except that picks have dynasty value but no redraft value, so trading picks to an opponent does not hurt their starting lineup.

---

## 3. DynastyProcess (open-source R/Shiny)

Source: [`dynastyprocess/apps-calculator`](https://github.com/dynastyprocess/apps-calculator) at commit `63aa30b55e2905634e2b3964e4c5cfe16f9a45f3` (2026-10-01). See [`R/values.R`](https://github.com/dynastyprocess/apps-calculator/blob/63aa30b55e2905634e2b3964e4c5cfe16f9a45f3/R/values.R), [`app.R`](https://github.com/dynastyprocess/apps-calculator/blob/63aa30b55e2905634e2b3964e4c5cfe16f9a45f3/app.R) and [`R/1_ui.R`](https://github.com/dynastyprocess/apps-calculator/blob/63aa30b55e2905634e2b3964e4c5cfe16f9a45f3/R/1_ui.R).

### 3.1 Value formula [SRC]

```r
.calculate_value <- function(df,value_factor){
  .value_factor <- value_factor / 10000
  df_v <- df[,value := round(10500 * exp(-.value_factor * ecr))]
```

`value = round(10500 · e^(−f·ECR))`, where ECR is the FantasyPros dynasty expert consensus rank. `f` is the "Valuation Factor" slider: `min=185 max=260 value=235` (that is, f = 0.0235), described as *"Tunes how star players are valued relative to bench players."* With the default, ECR 1 is 10,256, ECR 12 is 7,920, ECR 24 is 5,974, ECR 50 is 3,243 and ECR 100 is 1,001 **[RUN, by formula]**. Raising the factor makes the curve steeper, which favours studs.

### 3.2 Package discount [SRC]

There is no explicit package discount. Each side is a plain sum (`vA[,.(Total = sum(Value))]`). The only stud and depth control is the steepness of the exponential curve, which the user sets.

### 3.3 Fairness band [SRC]

```r
percent_diff <- if (A > B) round(100*((A - B)/B)) else if (A < B) round(100*((B - A)/A)) else 0
labelText = fcase(A == B, 'Trade is equal!', percent_diff <= 5, 'Trade is ~ fair!', A > B, 'in favour of Team A', …)
```

The trade is fair if the difference is **≤ 5% of the smaller side**, which is stricter than KTC's 5% of the sum. When the gap is over 5%, the "Trade Wizard" lists assets valued within ±5% of the raw gap (`Value <= diff*1.05 & Value >= diff*0.95`).

### 3.4 Counterparty [SRC]

Not considered. The inputs are QB format, team count, valuation factor, rookie optimism, future-pick factor and startup mode.

---

## 4. Dynasty Daddy (secondary example, KTC-derived)

Source: production bundle `https://dynasty-daddy.com/chunk-NPUQFBBX.js` (Angular), fetched 2026-10-10. The public GitHub repo [`G-Sher/dynasty-daddy`](https://github.com/G-Sher/dynasty-daddy) was last committed in 2021 and does not contain this logic.

### 4.1 Value adjustment [SRC]

The adjustment only applies when the market is KTC (`fantasyMarket===X.KeepTradeCut ? determineValueAdjustment(…) : plain sums`).

- **Choosing the stud:** sort both sides by value and compare them top-down in pairs. When the higher asset is within 5% (`higher·0.95 <= lower`), both are cancelled and the comparison moves to the next pair. The first asset not matched within 5% is the "stud".
- **Adjustment:** `round(studValue / (T1+T2) · otherSideTotal) · multiplier`, credited to the stud's side.
- **Multiplier:** starts at 1. Subtract 0.2 for each asset on the other side that is worth less than 95% of the stud **and** sits within ±5 places of the stud in the global value ranking (±20 places if the stud is ranked outside the top 10). Close substitutes therefore shrink the premium.
- Example [RUN, by formula, multiplier assumed 1]: 7,000 vs 3,500 + 3,500 gives an adjustment of 7000/14000 · 7000 = +3,500, so 10,500 vs 7,000.

### 4.2 Fairness band [SRC]

`acceptanceVariance = 5` (default). `acceptanceBuffer = (T1 + T2 + adjustment) · 5%`. The trade counts as even when `valueToEvenTrade < acceptanceBuffer`. In the multi-team model, a team is fair when `|received − given| ≤ (received + given) · 5%`. The trade-finder autofill adds up to 4 assets from the counterparty until the gap is inside the buffer, and honours user-set `positionTierPreferences` and `excludePosGroup`. **[INFERRED]** I did not find a counterparty-needs or contend/rebuild model in the parts I read.

---

## 5. Others

- **Sleeper:** I found no first-party trade-value or fairness feature in Sleeper's own documentation. The read-only API at `docs.sleeper.com` exposes transactions and rosters but no trade values. Third-party browser extensions such as "Tradyr" overlay KTC or FantasyCalc values on Sleeper trade screens. **[INFERRED: absence of evidence, not verified exhaustively]**
- **Dynasty Nerds:** the public pricing page (`https://dynastynerds.com/plans-and-pricing/`) describes the calculator only as "Instant dynasty trade analysis" and includes a testimonial claiming it "knows my roster". It does not publish a formula. Not verified.
- **Dynasty League Football (DLF):** a search-result snippet for `https://dynastyleaguefootball.com/dynasty-trade-calculator/` describes a package adjustment that grows with the asset gap. The page returned HTTP 403 to every fetch, so this is **unverified** and omitted from the comparison.

---

## 6. Comparison summary

| | KTC | FantasyCalc calculator | FantasyCalc Suggested Trades | DynastyProcess | Dynasty Daddy |
|---|---|---|---|---|---|
| Fair band | diff ≤ 5% of **sum** (slider 0–10) | none (exact only) | \|diff\| ≤ **500 abs** (slider 0–2000) | diff ≤ 5% of **smaller side** | diff < 5% of (sum + adj) |
| Package / stud premium | Nonlinear per-asset discount relative to the top asset in the trade, inverted back to a raw "player to add". Large (≈ +4.6k on 7k vs 3.5k×2) | Flat ≈ 753 per extra roster spot, min(0.698·v) | Same as calculator | None (curve steepness only) | stud/total × other side, −20% per close substitute |
| Uses other team's roster | No | No (only to filter "players to equalize") | **Yes**: starting-lineup delta for them (+0.4 weight), penalty for taking their starters | No | Only for autofill sourcing |
| Other team contend/rebuild | No | No | No (user's strategy only) | No | No |

---

## 7. Implications for dynastyff

*This section is my recommendation, kept apart from the findings above.*

1. **Add a hard fairness gate from the counterparty's side before scoring.** Today `tradeRecommender.ts` pairs a value-sell outbound with the counterparty's *most valuable* future pick and keeps any candidate with `compositeScore > 0`, with no check that the counterparty gets enough back. That is how Rodgers gets matched with a 1st. All of these tools reject or flag trades outside a value band first. A reasonable default is KTC/DP style: `|in − out| / (in + out) ≤ 5%`, computed with *the counterparty as the receiver*. A FantasyCalc-style absolute band would also work.
2. **Pick the inbound asset by value-match, not "most valuable".** Our player swap already does this ("closest dynasty value"). The pick-acquisition and value-sell paths should choose the counterparty pick, or pick plus filler, whose value lands inside the band, the way FantasyCalc chooses fillers from the opponent's lowest-`q` assets.
3. **Add a consolidation adjustment for uneven piece counts.** The cheapest option is FantasyCalc's flat roster-spot credit: `Σ min(0.698·v_i, 753)` over the extra pieces, which would need rescaling to our `dynasty_value` scale. KTC's `processVNew` curve is the strongest documented stud premium if we want one. Apply it before the fairness gate.
4. **Model the counterparty's benefit explicitly.** FantasyCalc's finder is the closest prior art: score `+0.4 × their starting-lineup delta` and `−0.2 × the lineup cost of what they give`. Our Roster Evaluator can already re-grade any team, so `positionalNeedScore` from the counterparty's perspective is cheap to add. None of the surveyed tools model the **counterparty's** contend/rebuild status. Our `classifyTeamContext` would be new ground here. A 42-year-old QB should be worth close to zero to a rebuilder, and something like redraft value to a contender.
5. **Age decay belongs in the value the counterparty sees.** FantasyCalc separates `redraftValue` from `dynastyValue` and uses the difference (`diff`) to route win-now assets to contenders. Our `players.dynasty_value` should already price in age. If our source values lag reality, a redraft-versus-dynasty split would let the recommender target contenders for value sells.
