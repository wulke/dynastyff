# LLD: TE-Premium Scoring

## Interface / Data Model

- `tePremiumTier` is an orthogonal draft setting: `off | tep | tepp | teppp`.
- `players` stores `dynasty_value_tep`, `dynasty_value_tepp`, and `dynasty_value_teppp` alongside base `dynasty_value`.
- KTC's embedded `playersArray` supplies `tep`, `tepp`, and `teppp` values nested under each player's format block (`superflexValues.tep`, `superflexValues.tepp`, `superflexValues.teppp`; the same keys also exist under `oneQBValues`). They are **not** top-level player fields. The ETL reads the `superflexValues` block, matching the base value it already uses. Each tier is normalized with the KTC base scale and averaged with the non-KTC source values, matching base dynasty-value aggregation.

## Logic Flow

1. Extract KTC base and three premium values from the existing dynasty-rankings payload.
2. Normalize every value with the run's KTC player normalization context and persist the three adjusted dynasty values.
3. Persist the independently selected tier on drafts and saved league configs.
4. While scoring a bot pick, substitute the selected adjusted value only when the candidate is a TE; all other positions keep base `dynasty_value`.

## Edge Case Probe

- Premium off -> all candidates use base `dynasty_value`.
- Non-TE with a premium tier -> use base `dynasty_value`.
- Premium keys found only at the player top level (the pre-#187 assumption) -> ignored; reading them yields no premium values on live KTC data.
- A missing KTC premium value -> preserve `NULL`; bot scoring falls back to base value.
- KTC TE+ mapping -> KTC describes TE+ as a mild/moderate boost such as `+.5PPR/.75PPR`; this product maps a +0.5 reception bonus to `tep`.
