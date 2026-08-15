⭐⭐ THE THESIS (Dan, 2026-08-14, verbatim): "One of my greatest sources of friction doing any kind of manual QA is having to stop and log my results. Working with an AI means I can both capture findings, instrument the system so that it *can* capture findings, and update the system in real time."

That is the product, and tonight is the proof. Manual QA has always had a tax: the tester is the instrument, and every finding costs a context switch out of testing to write it down — which is exactly the interrupt that destroys flow and, for Dan specifically, working memory. So findings get compressed to "something felt off", or lost.

Three things collapsed into one session here, and it is the combination that is new:
1. CAPTURE — he spoke one line mid-play ("tapping 0 shows no obvious change") and kept tapping. The finding was ticketed, root-caused in source, and cross-linked without him leaving the game.
2. INSTRUMENT — the system was made able to capture findings on its own. The dropped-tap defect was not reported by a human at all; it surfaced as a statistical fingerprint in telemetry (one-position realignment matching 28/35 vs 19/35) and was only then confirmed in source.
3. UPDATE IN REAL TIME — the harness changed WHILE the session ran. Guide desync was diagnosed and fixed mid-run, and the error class stopped dead: 46 consecutive clean rolls after.

The tester never stopped testing. That is the pitch, and it is checkable against timestamps.

--- THE METHOD, WHICH IS ALSO THE STORY ---

"How I'm encountering friction and building tooling on the fly here." Not 'a harness found five bugs' — that is the outcome. The story is Pattern 158's mission executed live: build tools that make the problem that is annoying you go away. Don't fix the bug, build the tool.

Each step is friction hit and tooling grown in response, unplanned:
1. Wanted to test on a phone -> no faithful data -> deterministic simulator producing a golden run in the app's own shape.
2. A random golden run had no Bunco and no tie -> rare paths never exercised -> seed search that requires them.
3. Needed to know if the live app agreed -> nothing could see a phone session -> event log, collector, live diff.
4. Plain HTTP silently disabled the screen wake lock -> measured on the actual device rather than asserted -> two cloudflared tunnels for HTTPS both ends, no account or firewall change.
5. Paper guide read while tapping -> one dropped input desynced everything, 46 rolls read as failures -> synced the guide to the app's own counters.
6. A misclick still cost the whole run -> undo-prompting that repairs the run while retaining the wrong tap, the prompt and the undo in the log, so the friction metric survives the correction.
7. Results could not be tied to a version -> git sha + dirty flag + build time stamped through the whole chain.

Same move every time: hit friction, name it precisely, build the smallest thing that removes it, keep going. Also the works-both-ends method in the wild — manufacture a known-working reference, reverse toward it, keep the reference as the test.

--- THE COUNTABLE RESULT ---

simple-bunco-scorecard had 52 passing tests, including full-game simulations against the real state composable that had already caught five scoring defects. The logic was well covered. One evening of live-instrumented play on a real phone found FIVE MORE, none visible to any offline test, because every one lives between the finger and the code.

1. No touch-action anywhere, so iOS double-tap zoom swallowed rapid taps.
2. -webkit-tap-highlight-color: transparent plus a zero-point tap not moving the score = the most common tap in the game gives no feedback, so a swallowed tap is undetectable.
3. Round-end screen shows no round score, removing the one natural checkpoint where a desync would surface.
4. BUNCO celebration auto-advances in 2000ms, defeating the Undo button beside it — whose own code comment says it exists because a mis-tapped Bunco is the largest possible scoring error.
5. Method defect: a guide kept aligned BY HAND desyncs the moment an input is dropped, after which every downstream comparison is noise.

THE PITCH: forensic method applied to a black box you are allowed to instrument. Same family as the SCORM debugger — capture what the runtime ACTUALLY did, diff against what it should have done, let the delta name the fault. "Provider of clarity"; "I cheat, but I cheat fair", the cheat being a known-correct run to reverse toward.

⚠️ SCOPE DISCIPLINE — do not overclaim:
- His own small personal app. No client, no contract, no production traffic.
- Input-layer and UX defects in a hobby project. Real, reproducible, root-caused — and small.
- "Found 5 defects a 52-test suite missed" is TRUE and is the strongest honest sentence available. Do not escalate to enterprise scale, imply a customer, or attach dollar figures.
- Built in one evening — genuine and checkable. Say that rather than implying a long engagement.
- Run outward-facing copy through check-claims.ts first.

ARTIFACTS: PR novakda/simple-bunco-scorecard#3 (branch feat/telemetry, TELEMETRY.md); raw NDJSON session logs + generated report; defect tickets #1050 #1051 #1052 #1054, method finding #1055; generalization #1053; save/restore and build-tracking tickets alongside.

#1053 is the PRODUCT, this is the STORY. Written case study, open-core tool, or both — open-core plus managed hosting is the standing S10 model.

(Written 2026-08-14 into a background-agent job scratch dir, with a note to copy it somewhere
durable before cleanup. A copy WAS made to Downloads and the full body was also written to work
item #1058. Recovered here 2026-08-15 — this repo is the durable home. Verified byte-identical
to the #1058 ticket body.)
