# Memory Files Status — R0.5 Audit (2026-07-18)

## Already committed (Emergent pod migration, 09:30 today)

| File | Location |
|---|---|
| PRD.md | `memory/PRD.md` (105 KB) |
| FNO_COMPLETION_MISSION | `memory/forensics/fno_completion_mission.md` |
| case_study_2026-07-17 | `memory/forensics/case_study_2026-07-17.md` |
| phase0_data_availability_matrix | `memory/forensics/phase0_data_availability_matrix.md` |
| AUDIT_2026_07_14 | `memory/AUDIT_2026_07_14.md` |
| BACKTEST_REPLAY_HARNESS_SPEC | `memory/BACKTEST_REPLAY_HARNESS_SPEC.md` |
| pre_post_briefing_build_plan | `memory/pre_post_briefing_build_plan.md` |
| row_k_rate_sweep_2026-07-17 | `memory/forensics/row_k_rate_sweep_2026-07-17.md` |

## New in R0 (this session)

| File | Location |
|---|---|
| REPLIT_MIGRATION_NOTES.md | `memory/REPLIT_MIGRATION_NOTES.md` |
| BEHAVIOR_MEMO_F32_F27_F37.md | `memory/BEHAVIOR_MEMO_F32_F27_F37.md` |

## Still missing

| File | Status |
|---|---|
| PROJECT_DELTA_REPORT.md | Not found in repo — provide as attachment |
| Conversation-record PDF | Reference only (not a committed file) |

## Security note

`memory/test_credentials.md` contains the site admin master password committed to git.
Credentials must NOT be in version control. This file should be deleted from the repo
and the secret stored only in Replit's secret manager (APP_ACCESS_PASSWORD env var, which
is already provisioned). Owner decision needed before next push.
