# Design rationale: a calm place to start

The interface is meant to feel like a quiet room. Pressing Start should be the last decision the screen asks for. These choices are design interpretations of the research below, not guarantees. Many of these effects are modest and context-dependent.

## What the research suggests, and what we did

| Finding | Source | Design decision |
|---|---|---|
| Directed attention is a limited resource that recovers in settings with gentle, effortless stimuli (nature-like softness, no demands). | Kaplan (1995), *The restorative benefits of nature*, J. Environmental Psychology 15(3); Berman, Jonides & Kaplan (2008), Psychological Science 19(12) | Sage and slate-teal palette, low contrast between surfaces, no sharp accent colors, generous empty space. |
| Calming visual environments reduce physiological stress. | Ulrich (1984), Science 224 | Soft, desaturated light and dusk-toned dark mode (no pure black, no neon). |
| Colour influences cognitive style; cool hues such as blue are associated with relaxed, open thinking, while red enhances vigilance and detail checking. | Mehta & Zhu (2009), Science 323; Lichtenfeld et al. (2012), Personality and Social Psychology Bulletin | The tomato red is gone. Focus uses slate teal, break uses moss green. |
| Interruptions raise stress and leave attention residue on the next task. | Mark, Gudith & Klocke (2008), CHI; Leroy (2009), OBHDP 109 | While a session runs, leaderboards, charts and stats fade out. Only the dial, Pause and Reset remain. |
| The mere presence of salient stimuli (even an unused phone) costs working-memory capacity. | Ward et al. (2017), J. Association for Consumer Research 2(2) | The same principle applied to the page: no competing numbers or rankings in view during focus. |
| Moderate ambient noise (~70 dB) can aid creative work; high noise hurts. | Mehta, Zhu & Cheema (2012), J. Consumer Research 39 | The app stays silent by design (silent notifications only, no audio). |
| Short breaks restore vigor and reduce fatigue. | Albulescu et al. (2022), PLOS ONE (micro-break meta-analysis) | Break phase brings the page back softly and shifts to green, signalling rest. |

## Behaviour of the redesign

- **Before Start:** one column, the dial in the first viewport, stats and comparisons below it.
- **During Focus or Pause:** the page recedes over about 0.9 s, the header drops to low opacity (hover or keyboard focus restores it), the mode switch and notification button hide, and the page stops scrolling. Pause is a quiet outline button.
- **During Break:** content returns, the accent turns moss green.
- **Motion:** one slow fade on Start; no pulsing, confetti or animated rings beyond the existing progress. `prefers-reduced-motion` removes the transition.
- **Typography:** system rounded face, a light-weight clock with tabular numerals.

Behaviour, element ids and JavaScript are unchanged; the redesign is HTML structure plus CSS only.
