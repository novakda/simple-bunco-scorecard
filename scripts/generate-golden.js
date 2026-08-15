#!/usr/bin/env node
/**
 * Write a golden game to disk for the collector to diff live sessions against.
 *
 *   node scripts/generate-golden.js --find --out telemetry/golden-game.json
 *
 * Flags:
 *   --seed N    fixed seed (default 7)
 *   --find      search for a seed whose game contains a Bunco, three
 *               mini-Buncos and a tie, so the rare UI paths get exercised
 *   --sets N    sets in the game (default 3, which is 18 rounds)
 *   --seat 1-4  which seat is you (default 1)
 *   --out FILE  where to write (default golden-game.json)
 *
 * The simulation itself lives in src/lib/goldenGame.js so the tests and this CLI
 * build their expectations from the same code.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildGame, findSeed, exercisesRarePaths } from '../src/lib/goldenGame.js'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(name)
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const opts = {
  seed: Number(arg('--seed', '7')),
  sets: Number(arg('--sets', '3')),
  seat: Number(arg('--seat', '1')),
  file: arg('--out', 'golden-game.json'),
  find: argv.includes('--find'),
}

const buildOpts = { sets: opts.sets, seat: opts.seat }
let golden = buildGame(opts.seed, buildOpts)

if (opts.find && !exercisesRarePaths(golden)) {
  const found = findSeed(buildOpts)
  if (!found) {
    console.error('no seed produced a Bunco, three mini-Buncos and a tie — widen the search')
    process.exit(1)
  }
  golden = found
  console.log(`--find selected seed ${golden.seed} (it exercises BUNCO, MINI-BUNCO and TIE)`)
}

if (!existsSync(dirname(opts.file))) mkdirSync(dirname(opts.file), { recursive: true })
writeFileSync(opts.file, JSON.stringify(golden, null, 2))

const { summary, rounds } = golden
const t = summary.results
console.log(`golden game -> ${opts.file}`)
console.log(
  `seed ${golden.seed} | seat ${golden.seat} (${golden.seatName}) | ${summary.totalRolls} rolls you enter across ${rounds.length} rounds`
)
console.log(
  `W ${t.W} / L ${t.L} / T ${t.T} | ${summary.buncos} bunco, ${summary.miniBuncos} mini | ${summary.roundsCutShortByHeadTable} rounds cut short by the head table`
)
for (const r of rounds) {
  console.log(
    `  set ${r.set} round ${r.round} (target ${r.target}): ${String(r.myRolls.length).padStart(2)} taps -> ${String(r.expectedRoundPoints).padStart(2)} pts, ${r.expectedResult}${r.cutShort ? ' [cut short]' : ''}${r.endsOnBunco ? ' [BUNCO]' : ''}`
  )
}
