# EARS Specs: TE-Premium Scoring

Drives: `docs/llds/te-premium-scoring.md`

| ID | Requirement | Status |
|---|---|---|
| DFF-TEP-001 | When KTC's embedded player payload contains `tep`, `tepp`, and `teppp` values, the ETL system shall extract and persist a TE-premium-adjusted dynasty value for each tier alongside base `dynasty_value`. | [ ] → #166 |
| DFF-TEP-002 | When a draft or saved league configuration is created, the system shall accept an independent `tePremiumTier` of `off`, `tep`, `tepp`, or `teppp` without altering the base scoring format. | [ ] → #166 |
| DFF-TEP-003 | When bot pick scoring evaluates a TE and TE premium is enabled, the system shall use that tier's adjusted dynasty value; it shall use base `dynasty_value` for non-TE players and when premium is off. | [ ] → #166 |
| DFF-TEP-004 | When a league grants TEs a +0.5 reception bonus, the system shall select KTC's `tep` tier, which KTC documents as TE+ for a mild/moderate bonus including +.5 PPR. | [ ] → #166 |
