import { LiveMatchState } from "./sportsApi.js";

// EPL average goals per 90 minutes, home vs away — approximate, based on recent-season scoring rates.
// Home advantage is well-documented; exact values should ideally be recomputed from a real dataset per season.
const LEAGUE_AVG_HOME_GOALS_PER_90 = 1.53;
const LEAGUE_AVG_AWAY_GOALS_PER_90 = 1.13;
const MAX_ADDITIONAL_GOALS = 8; // practical cap — P(9+ goals) is negligible

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

    const lambdaHome = LEAGUE_AVG_HOME_GOALS_PER_90 * fractionRemaining;
    const lambdaAway = LEAGUE_AVG_AWAY_GOALS_PER_90 * fractionRemaining;

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