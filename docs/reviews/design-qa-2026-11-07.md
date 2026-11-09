# Production-v1 fidelity QA

final result: passed

Target: https://77-221-140-87.sslip.io/downloads/android/previews/production-v1/?view=requirements&v=20261107-14

Frozen reference SHA-256: 96fe23cfa4ea3e2f5f9c2017c36b123ad04522b9985b753f00de01600b39e6ac.
Implementation: fix/production-mockup-fidelity-20261107; actual bundled client in a local test match.
Capture matrix: 390×844, 320×740, 1440×960, 844×390; device scale 1.
Evidence: /mnt/data/production-fidelity/reference-*.png, game-*.png and compare-*.png.

## Scope and comparison

Post-fix reference and implementation were inspected together in combined images for the phone
catalogs, fitting, requirements, heroes, equipment, flagship selector and entity cards; additionally
320px fitting/unit cards, desktop catalog and landscape equipment/building cards were inspected.
This is a visual integration review, not a claim of pixel identity or production deployment.
The actual client retains its HUD/navigation and current match values, assets, roster and rules.
The demonstration uses different prices, durations, available technology and installed modules;
those content states are not identical and are not treated as layout regressions.

## Resolved findings

- P1: legacy constructor hierarchy replaced with catalog plus separate fitting surface.
- P1: building rows compacted to identity/output plus quote/action; descriptions remain in cards.
- P1: hero tabs replaced by summary, ability tiles, development and equipment disclosures.
- P1: disclosure state restored by identity, avoiding transfer between unrelated sections.
- P1: short-screen production, technology and codex surfaces avoid floating-window clipping.
- P1: building list now has a single scroll owner and restores position after presentation.
- P2: income control uses the game palette; narrow requirements wrap with actionable remedies.
- P2: nested Back/Escape closes one surface and preserves the parent selection.
- P2: dossier back arrow explicitly visible outside the holographic skin.
- P2: dossier body scrolls while its header and primary action remain accessible.

No unresolved P0/P1/P2 visual blocker was identified in the inspected post-fix states.
P3 follow-up: the long Infrastructure label wraps on phones; wording, capitalization and close
button decoration retain game conventions and can be refined after the owner's screenshot review.

## Functional evidence

- Whole repository gate: lint, types, 15,315 tests passed (236 skipped), docs-check passed.
- Final rebuilt client: four viewport interaction smoke runs passed; zero page errors.
- Final four viewport screenshot capture completed with zero page errors.
- Full phone onboarding passed, including research, construction, movement, capture, market,
  hero equipment, batch ground-unit production, aviation and assault.
- Latest small presentation changes after the whole gate were covered by the final build and
  browser runs. The commit gate is rerun on the final tree after integrating fresh main.

The owner requested real game screenshots before PR creation. The review page is a static image
comparison, not a separately deployed playable client. The owner reviewed the screenshot handoff and agreed to continue before PR preparation.
