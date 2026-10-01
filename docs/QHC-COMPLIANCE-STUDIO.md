# QHC Compliance Studio

`public/3D planning.html` is the state-wide preliminary design-and-siting tool for the pending Queensland Housing Code (QHC).

## Regulatory baseline

- Rule source: Queensland Housing Code, pending publication version dated 3 August 2026.
- Proposed commencement: 1 September 2026, subject to Governor-in-Council approval.
- Transition: local governments may adopt the QHC during a three-year transition period.
- Chapters: QDC Part 1.1 applies below 450m²; QDC Part 1.2 applies from 450m².

The rules are isolated in `public/qhc-rules.js`. Update its `VERSION` object and tests whenever the official publication, commencement status or acceptable solutions change.

## Included checks

- QHC application gates: PDA, permitted use, council adoption, overlays and approved plan of development.
- Maximum building height, including the steep-lot increase.
- Primary frontage, side and rear setbacks.
- Class 10a built-to-boundary length.
- Site cover and secondary-dwelling internal floor area.
- Parking count, covered parking, dimensions confirmation and access width.
- Ground-level private open-space dimension, area, open-to-sky area and slope.
- Manual confirmations for visual privacy, maintenance-free inaccessible walls and an identifiable entry.

The 3D scene colours the proposal green, amber or red and displays the default acceptable-solution envelope. The model uses an effective rectangular lot; survey-plan dimensions remain the source of truth. Live mapping uses ArcGIS and the Queensland DCDB. A local 3D preview remains available when mapped context cannot load.

## Important limits

This is a preliminary visual aid. It does not issue a building approval or certification and does not assess every performance criterion, performance solution, NCC requirement, planning-scheme provision, overlay, QDC part or other law. Irregular lots, secondary frontages and detailed building elements still require professional assessment.

## Verification

Run the rule regression suite from the project root:

```powershell
npm.cmd run test:qhc
```

The home page links directly to `3D planning.html`. Drafts are stored only in the user's browser under `lotwise-qhc-assessment-v1`.
