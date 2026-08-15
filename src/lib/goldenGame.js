/**
 * Golden-game builder.
 *
 * Produces a simulated game in the shape THIS APP records: three sets of six
 * rounds, the round number is the target, and the only rolls that come back are
 * the player's own — that is all they would ever tap into a personal scorecard.
 *
 * A full table of four is simulated so the W/L/T at the end of each round is
 * honest rather than invented, but the other three seats are discarded.
 *
 * Imported by scripts/generate-golden.js (the CLI) and by the end-to-end test,
 * so the expectations the tests assert and the expectations the collector diffs
 * against are built by the same code.
 */

export const ROUNDS_PER_SET = 6
export const WIN_AT = 21
export const MINI_BUNCO = 5

// Partners sit across: seats 1+3 are one team, 2+4 the other.
export const SEATS = [
  { seat: 1, name: 'You', team: 1 },
  { seat: 2, name: 'Opponent A', team: 2 },
  { seat: 3, name: 'Partner', team: 1 },
  { seat: 4, name: 'Opponent B', team: 2 },
]

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Score one roll of three dice. Mirrors the app's rules exactly. */
export function scoreRoll(dice, target) {
  const allSame = dice[0] === dice[1] && dice[1] === dice[2]
  if (allSame && dice[0] === target) return { points: 21, type: 'bunco' }
  if (allSame) return { points: MINI_BUNCO, type: 'mini' }
  return { points: dice.filter((d) => d === target).length, type: 'normal' }
}

export function buildGame(seed, { sets = 3, seat = 1 } = {}) {
  const me = SEATS.find((s) => s.seat === seat)
  if (!me) throw new Error(`seat must be 1-4, got ${seat}`)

  const rand = mulberry32(seed)
  const d6 = () => 1 + Math.floor(rand() * 6)

  const rounds = []
  let startIdx = 0

  for (let set = 1; set <= sets; set++) {
    for (let round = 1; round <= ROUNDS_PER_SET; round++) {
      const target = round

      // The head table ends the round for everybody the moment it reaches 21, so
      // a round here can be cut short with neither team at 21. That is the only
      // way a round ties, and the app has a TIE button, so it has to happen.
      const cutoff = rand() < 0.2 ? 6 + Math.floor(rand() * 22) : Infinity

      let s1 = 0
      let s2 = 0
      let idx = startIdx
      let rollNo = 0
      const myRolls = []
      let cutShort = false

      while (s1 < WIN_AT && s2 < WIN_AT) {
        if (rollNo >= cutoff) {
          cutShort = true
          break
        }
        const p = SEATS[idx % 4]
        const dice = [d6(), d6(), d6()]
        const { points, type } = scoreRoll(dice, target)
        rollNo++

        if (p.team === 1) s1 += points
        else s2 += points

        if (p.seat === me.seat) {
          myRolls.push({
            set,
            round,
            target,
            dice,
            points,
            type,
            // What the player physically taps to enter this roll.
            tap: type === 'bunco' ? 'BUNCO!' : type === 'mini' ? 'MINI-BUNCO' : String(points),
          })
        }

        if (s1 >= WIN_AT || s2 >= WIN_AT) break
        if (points === 0) idx++ // the dice pass only on a scoreless roll
      }

      const mine = me.team === 1 ? s1 : s2
      const theirs = me.team === 1 ? s2 : s1

      rounds.push({
        set,
        round,
        target,
        cutShort,
        tableScore: { mine, theirs },
        expectedRoundPoints: myRolls.reduce((n, r) => n + r.points, 0),
        expectedResult: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
        myRolls,
        // A Bunco by the player sends the app straight to round-end, so nothing
        // can be entered after it. It is therefore always the round's last tap.
        endsOnBunco: myRolls.length > 0 && myRolls[myRolls.length - 1].type === 'bunco',
      })

      startIdx = (startIdx + 1) % 4
    }
  }

  // The exact arrays the app should hold in localStorage once the game is over.
  const expectedRolls = rounds.flatMap((r) =>
    r.myRolls.map((x) => ({ set: x.set, round: x.round, points: x.points, type: x.type }))
  )
  const expectedResults = rounds.map((r) => ({ set: r.set, round: r.round, result: r.expectedResult }))

  const results = { W: 0, L: 0, T: 0 }
  for (const r of expectedResults) results[r.result]++

  return {
    generator: 'src/lib/goldenGame.js',
    seed,
    seat: me.seat,
    seatName: me.name,
    model: {
      sets,
      roundsPerSet: ROUNDS_PER_SET,
      totalRounds: sets * ROUNDS_PER_SET,
      targetIsRoundNumber: true,
      winAt: WIN_AT,
      miniBuncoPoints: MINI_BUNCO,
      entryScope: "the player's own rolls only",
    },
    summary: {
      totalRolls: expectedRolls.length,
      totalPoints: expectedRolls.reduce((n, r) => n + r.points, 0),
      buncos: expectedRolls.filter((r) => r.type === 'bunco').length,
      miniBuncos: expectedRolls.filter((r) => r.type === 'mini').length,
      results,
      roundsCutShortByHeadTable: rounds.filter((r) => r.cutShort).length,
    },
    rounds,
    expectedRolls,
    expectedResults,
  }
}

/**
 * A game worth testing against exercises the paths a random game usually misses:
 * the Bunco celebration screen, the MINI-BUNCO button, and the TIE result.
 */
export function exercisesRarePaths(g) {
  return g.summary.buncos >= 1 && g.summary.miniBuncos >= 3 && g.summary.results.T >= 1
}

/** First seed at or after `from` whose game exercises the rare paths. */
export function findSeed(opts = {}, from = 1, limit = 100000) {
  for (let seed = from; seed <= limit; seed++) {
    const g = buildGame(seed, opts)
    if (exercisesRarePaths(g)) return g
  }
  return null
}
