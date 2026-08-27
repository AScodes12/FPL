const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const cache = new NodeCache({ stdTTL: 600 }); // 10 minute cache

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FPL_API = 'https://fantasy.premierleague.com/api';
const ESPN_API = 'https://www.espncricinfo.com';

// Helper function to fetch with caching
async function fetchWithCache(url, cacheKey) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'FPL-Analyzer/1.0' },
      timeout: 10000
    });
    cache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    throw error;
  }
}

// Get all bootstrap data (players, teams, gameweeks)
app.get('/api/bootstrap', async (req, res) => {
  try {
    const data = await fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get fixtures data
app.get('/api/fixtures', async (req, res) => {
  try {
    const data = await fetchWithCache(`${FPL_API}/fixtures/`, 'fixtures');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get team entry data
app.get('/api/entry/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const cacheKey = `entry_${teamId}`;
    const data = await fetchWithCache(`${FPL_API}/entry/${teamId}/`, cacheKey);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get team picks for specific gameweek
app.get('/api/entry/:teamId/event/:eventId/picks', async (req, res) => {
  try {
    const { teamId, eventId } = req.params;
    const cacheKey = `picks_${teamId}_${eventId}`;
    const data = await fetchWithCache(
      `${FPL_API}/entry/${teamId}/event/${eventId}/picks/`,
      cacheKey
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get element (player) summary
app.get('/api/element/:elementId', async (req, res) => {
  try {
    const { elementId } = req.params;
    const cacheKey = `element_${elementId}`;
    const data = await fetchWithCache(
      `${FPL_API}/element-summary/${elementId}/`,
      cacheKey
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze team - comprehensive analysis
app.post('/api/analyze-team', async (req, res) => {
  try {
    const { teamId, currentGW } = req.body;

    // Fetch all required data
    const [entry, bootstrap, fixtures] = await Promise.all([
      fetchWithCache(`${FPL_API}/entry/${teamId}/`, `entry_${teamId}`),
      fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap'),
      fetchWithCache(`${FPL_API}/fixtures/`, 'fixtures')
    ]);

    const picks = entry.picks || [];
    const players = bootstrap.elements || [];
    const teams = bootstrap.teams || [];
    const gameweeks = bootstrap.events || [];

    // Build analysis
    const analysis = analyzeTeamData(
      entry,
      picks,
      players,
      teams,
      fixtures,
      gameweeks,
      currentGW
    );

    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hot form players
app.get('/api/hot-form', async (req, res) => {
  try {
    const { gws = 5 } = req.query;
    const bootstrap = await fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap');
    const players = bootstrap.elements || [];

    const hotForm = players
      .map(player => ({
        id: player.id,
        name: player.first_name + ' ' + player.second_name,
        team: player.team,
        position: ['GK', 'DEF', 'MID', 'FWD'][player.element_type - 1],
        form: parseFloat(player.form) || 0,
        points_per_game: parseFloat(player.points_per_game) || 0,
        total_points: player.total_points || 0,
        in_form: parseFloat(player.form) > 5,
        ownership: parseFloat(player.selected_by_percent) || 0,
        price: player.now_cost / 10
      }))
      .filter(p => p.form > 5)
      .sort((a, b) => b.form - a.form)
      .slice(0, 50);

    res.json(hotForm);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get likely to rise players
app.get('/api/likely-to-rise', async (req, res) => {
  try {
    const bootstrap = await fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap');
    const players = bootstrap.elements || [];

    const likelyToRise = players
      .map(player => ({
        id: player.id,
        name: player.first_name + ' ' + player.second_name,
        team: player.team,
        position: ['GK', 'DEF', 'MID', 'FWD'][player.element_type - 1],
        form: parseFloat(player.form) || 0,
        points_per_game: parseFloat(player.points_per_game) || 0,
        ownership: parseFloat(player.selected_by_percent) || 0,
        price: player.now_cost / 10,
        trend: player.status === 'd' ? 'declining' : 'active',
        cost_change: (player.cost_change || 0) / 10,
        rise_likelihood: calculateRiseLikelihood(player)
      }))
      .filter(p => p.rise_likelihood > 0.6)
      .sort((a, b) => b.rise_likelihood - a.rise_likelihood)
      .slice(0, 30);

    res.json(likelyToRise);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get fixture difficulty analysis
app.get('/api/fixture-analysis', async (req, res) => {
  try {
    const [bootstrap, fixtures] = await Promise.all([
      fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap'),
      fetchWithCache(`${FPL_API}/fixtures/`, 'fixtures')
    ]);

    const teams = bootstrap.teams || [];
    const gameweeks = bootstrap.events || [];

    const analysis = fixtures
      .filter(f => f.event && f.event <= (gameweeks[0]?.id || 1) + 10)
      .map(fixture => {
        const homeTeam = teams.find(t => t.id === fixture.team_h);
        const awayTeam = teams.find(t => t.id === fixture.team_a);

        return {
          id: fixture.id,
          event: fixture.event,
          homeTeam: homeTeam?.name || 'Unknown',
          awayTeam: awayTeam?.name || 'Unknown',
          homeFDR: fixture.team_h_difficulty || 0,
          awayFDR: fixture.team_a_difficulty || 0,
          status: fixture.status,
          home_score: fixture.team_h_score,
          away_score: fixture.team_a_score
        };
      })
      .sort((a, b) => (a.event || 999) - (b.event || 999));

    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transfer suggestions
app.post('/api/transfer-suggestions', async (req, res) => {
  try {
    const { teamId } = req.body;

    const [entry, bootstrap] = await Promise.all([
      fetchWithCache(`${FPL_API}/entry/${teamId}/`, `entry_${teamId}`),
      fetchWithCache(`${FPL_API}/bootstrap-static/`, 'bootstrap')
    ]);

    const picks = entry.picks || [];
    const players = bootstrap.elements || [];
    const teams = bootstrap.teams || [];

    const suggestions = generateTransferSuggestions(
      picks,
      players,
      teams,
      entry.bank / 10
    );

    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions

function analyzeTeamData(entry, picks, players, teams, fixtures, gameweeks, currentGW) {
  const currentEvent = entry.current_event || currentGW || gameweeks[0]?.id || 1;
  const starting11 = picks.filter(p => p.position <= 11);
  const bench = picks.filter(p => p.position > 11);

  // Calculate metrics
  const squadValues = starting11.map(pick => {
    const player = players.find(p => p.id === pick.element);
    return {
      ...pick,
      player: player ? `${player.first_name} ${player.second_name}` : 'Unknown',
      position: ['GK', 'DEF', 'MID', 'FWD'][player?.element_type - 1] || 'Unknown',
      form: parseFloat(player?.form) || 0,
      ppg: parseFloat(player?.points_per_game) || 0,
      price: (player?.now_cost || 0) / 10,
      ownership: parseFloat(player?.selected_by_percent) || 0
    };
  });

  const totalTeamValue = (entry.value || 1000) / 10;
  const bankValue = (entry.bank || 0) / 10;
  const averageForm = squadValues.reduce((sum, p) => sum + p.form, 0) / squadValues.length;

  // Fixture difficulty for next 3 gameweeks
  const nextFixtures = fixtures
    .filter(f => f.event && f.event > currentEvent && f.event <= currentEvent + 3)
    .slice(0, 3);

  const avgFixtureDifficulty = nextFixtures.length > 0
    ? nextFixtures.reduce((sum, f) => sum + (f.team_h_difficulty + f.team_a_difficulty) / 2, 0) / nextFixtures.length
    : 0;

  // Team rating calculation
  const formScore = Math.min(100, Math.max(0, (averageForm / 10) * 100));
  const valueScore = Math.min(100, (totalTeamValue / 100) * 100);
  const fixtureScore = Math.min(100, Math.max(0, (5 - avgFixtureDifficulty) * 20));
  const overallRating = Math.round((formScore * 0.4 + valueScore * 0.3 + fixtureScore * 0.3));

  // Bench strength
  const benchForm = bench.length > 0
    ? bench.reduce((sum, p) => {
        const player = players.find(pl => pl.id === p.element);
        return sum + (parseFloat(player?.form) || 0);
      }, 0) / bench.length
    : 0;

  return {
    teamRating: overallRating,
    formScore: Math.round(formScore),
    fixtureScore: Math.round(fixtureScore),
    benchStrength: Math.round((benchForm / 10) * 100),
    squadValue: totalTeamValue.toFixed(1),
    bankValue: bankValue.toFixed(1),
    startingSquad: squadValues.sort((a, b) => b.form - a.form),
    benchSquad: bench.map(p => {
      const player = players.find(pl => pl.id === p.element);
      return {
        ...p,
        player: player ? `${player.first_name} ${player.second_name}` : 'Unknown',
        form: parseFloat(player?.form) || 0,
        ppg: parseFloat(player?.points_per_game) || 0
      };
    }),
    weaknesses: identifyWeaknesses(squadValues),
    opportunities: identifyOpportunities(squadValues, players),
    nextFixtures: nextFixtures.slice(0, 5)
  };
}

function calculateRiseLikelihood(player) {
  let score = 0;

  // Form contribution
  const form = parseFloat(player.form) || 0;
  score += (form / 10) * 0.4;

  // Points per game
  const ppg = parseFloat(player.points_per_game) || 0;
  score += (ppg / 10) * 0.3;

  // Low ownership (contrarian pick)
  const ownership = parseFloat(player.selected_by_percent) || 0;
  if (ownership < 10) score += 0.2;
  else if (ownership < 30) score += 0.1;

  // Status
  if (player.status !== 'd') score += 0.1;

  return Math.min(1, score);
}

function generateTransferSuggestions(picks, players, teams, budget) {
  const starting11 = picks.filter(p => p.position <= 11);
  const outCandidates = starting11
    .map(pick => {
      const player = players.find(p => p.id === pick.element);
      return {
        pickId: pick.id,
        playerId: player?.id,
        name: player ? `${player.first_name} ${player.second_name}` : 'Unknown',
        team: player?.team,
        position: ['GK', 'DEF', 'MID', 'FWD'][player?.element_type - 1],
        form: parseFloat(player?.form) || 0,
        ppg: parseFloat(player?.points_per_game) || 0,
        price: (player?.now_cost || 0) / 10,
        value: (parseFloat(player?.form) || 0) * (parseFloat(player?.points_per_game) || 0)
      };
    })
    .sort((a, b) => a.value - b.value)
    .slice(0, 5);

  const inCandidates = players
    .filter(p => {
      const inPicks = starting11.find(pick => pick.element === p.id);
      return !inPicks && p.status !== 'd';
    })
    .map(player => ({
      playerId: player.id,
      name: `${player.first_name} ${player.second_name}`,
      team: player.team,
      position: ['GK', 'DEF', 'MID', 'FWD'][player.element_type - 1],
      form: parseFloat(player.form) || 0,
      ppg: parseFloat(player.points_per_game) || 0,
      price: (player.now_cost || 0) / 10,
      value: (parseFloat(player.form) || 0) * (parseFloat(player.points_per_game) || 0)
    }))
    .filter(p => p.price <= (outCandidates[0]?.price || 0) + budget)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const suggestions = outCandidates.map((out, i) => ({
    id: i,
    out: out,
    in: inCandidates[i] || { name: 'No suitable replacement', position: out.position },
    potentialGain: inCandidates[i]
      ? ((inCandidates[i].form - out.form) * 5).toFixed(1)
      : 0
  }));

  return suggestions;
}

function identifyWeaknesses(squad) {
  const weaknesses = [];

  // Low form players
  const lowFormPlayers = squad.filter(p => p.form < 3).slice(0, 2);
  if (lowFormPlayers.length > 0) {
    weaknesses.push({
      type: 'Low Form',
      players: lowFormPlayers.map(p => p.player),
      recommendation: 'Consider transferring out'
    });
  }

  // Injuries/red flags
  const suspectedInjured = squad.filter(p => p.form < 1).slice(0, 2);
  if (suspectedInjured.length > 0) {
    weaknesses.push({
      type: 'Potential Injuries',
      players: suspectedInjured.map(p => p.player),
      recommendation: 'Check team news'
    });
  }

  return weaknesses;
}

function identifyOpportunities(squad, allPlayers) {
  const opportunities = [];

  // High PPG players not in squad
  const missedHighPerformers = allPlayers
    .filter(p => {
      const inSquad = squad.find(s => s.id === p.id);
      return !inSquad && parseFloat(p.points_per_game) > 5;
    })
    .sort((a, b) => parseFloat(b.points_per_game) - parseFloat(a.points_per_game))
    .slice(0, 3);

  if (missedHighPerformers.length > 0) {
    opportunities.push({
      type: 'High PPG Available',
      players: missedHighPerformers.map(p => `${p.first_name} ${p.second_name}`),
      recommendation: 'Consider these performers'
    });
  }

  return opportunities;
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`FPL Analyzer server running on port ${PORT}`);
});
