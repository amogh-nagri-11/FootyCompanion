import { LiveMatchState, MatchEvent } from "./sportsApi.js";

// EPL average goals per 90 minutes, home vs away — approximate, based on recent-season scoring rates.
// Home advantage is well-documented; exact values should ideally be recomputed from a real dataset per season.
const LEAGUE_AVG_HOME_GOALS_PER_90 = 1.53;
const LEAGUE_AVG_AWAY_GOALS_PER_90 = 1.13;
const MAX_ADDITIONAL_GOALS = 8; // practical cap — P(9+ goals) is negligible

/**
 * Scoring multipliers for playing a man down.
 *
 * A red card is one of the largest in-match swings there is, and the model was
 * blind to it: a side could go down to ten with an hour left and the bar would
 * not move at all, which is exactly the moment a reader looks at it. The
 * numbers are a judgement call in the same spirit as the league averages above
 * — the ten-man side creates meaningfully less and concedes meaningfully more,
 * and a second dismissal is worse than twice as bad. They are not fitted to
 * data; retune them when there is a dataset to fit against.
 */
const RED_CARD_ATTACK_MULTIPLIER = [1, 0.72, 0.45];
const RED_CARD_DEFENCE_MULTIPLIER = [1, 1.35, 1.8];

const clampReds = (n: number) => Math.min(Math.max(n, 0), RED_CARD_ATTACK_MULTIPLIER.length - 1);

/**
 * Counts dismissals per side from the event log.
 *
 * The feed labels a second booking as its own detail string rather than as a
 * straight red, so both spellings count. A card event whose team matches
 * neither side is ignored rather than guessed at.
 */
export function countRedCards(
  events: MatchEvent[],
  homeTeam: string,
  awayTeam: string
): { home: number; away: number } {
  let home = 0;
  let away = 0;

  for (const event of events) {
    if (event.type !== 'card') continue;
    if (!/red card|second yellow|secondyellow/i.test(event.detail)) continue;

    if (event.team === homeTeam) home++;
    else if (event.team === awayTeam) away++;
  }

  return { home, away };
}

//poisson goal process model 
//lambda = xG and k = no. of goals ( the outcome you want to find the probability for )
function poissonPmf(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

export function calculateWinProbability(state: LiveMatchState): { home: number, away: number, draw: number } {
    const timeRemaining = Math.max(90 - state.minute, 0);
    const fractionRemaining = timeRemaining / 90;

    const reds = countRedCards(state.events ?? [], state.homeTeam, state.awayTeam);
    const homeReds = clampReds(reds.home);
    const awayReds = clampReds(reds.away);

    // Each side's rate is scaled twice: down for being short-handed, up for the
    // opponent being short-handed.
    const lambdaHome =
        LEAGUE_AVG_HOME_GOALS_PER_90 *
        fractionRemaining *
        RED_CARD_ATTACK_MULTIPLIER[homeReds] *
        RED_CARD_DEFENCE_MULTIPLIER[awayReds];
    const lambdaAway =
        LEAGUE_AVG_AWAY_GOALS_PER_90 *
        fractionRemaining *
        RED_CARD_ATTACK_MULTIPLIER[awayReds] *
        RED_CARD_DEFENCE_MULTIPLIER[homeReds];

    const currentDiff = state.homeScore - state.awayScore;

    let pHomeWin = 0;
    let pDraw = 0;
    let pAwayWin = 0;

    for (let hGoals = 0; hGoals <= MAX_ADDITIONAL_GOALS; hGoals++) {
        for (let aGoals = 0; aGoals <= MAX_ADDITIONAL_GOALS; aGoals++) {
            const jointProb = poissonPmf(lambdaHome, hGoals) * poissonPmf(lambdaAway, aGoals);
            const finalDiff = currentDiff + hGoals - aGoals;

            if (finalDiff > 0) pHomeWin += jointProb;
            else if (finalDiff === 0) pDraw += jointProb;
            else pAwayWin += jointProb;
        }
    } 
    
    const total = pHomeWin + pDraw + pAwayWin; // should be ~1, but normalize for the truncated sum
    return {
        home: Math.round((pHomeWin / total) * 100),
        away: Math.round((pAwayWin / total) * 100),
        draw: Math.round((pDraw / total) * 100),
    };
}