import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable CORS and JSON body parsing
app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, CSS, JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Standard headers to prevent FPL API cloud blocking
const FPL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://fantasy.premierleague.com/'
};

// --- API ROUTES ---

// Fix for 404: Endpoint for /api/analyze-team
app.post('/api/analyze-team', async (req, res) => {
  try {
    const { teamId } = req.body;

    // Fetch static data (players, teams) and manager data in parallel
    const [staticRes, managerRes] = await Promise.all([
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: FPL_HEADERS }),
      teamId ? fetch(`https://fantasy.premierleague.com/api/entry/${teamId}/`, { headers: FPL_HEADERS }) : null
    ]);

    if (!staticRes.ok) {
      return res.status(staticRes.status).json({ error: 'Failed to fetch core FPL data' });
    }

    const staticData = await staticRes.json();
    let managerData = null;

    if (managerRes && managerRes.ok) {
      managerData = await managerRes.json();
    }

    // Return analyzed payload back to client
    res.json({
      success: true,
      manager: managerData,
      totalPlayers: staticData.elements ? staticData.elements.length : 0,
      elements: staticData.elements,
      teams: staticData.teams
    });
  } catch (error) {
    console.error('Error analyzing team:', error);
    res.status(500).json({ error: 'Internal server error while analyzing team' });
  }
});

// Also support GET for /api/analyze-team if requested via URL query params
app.get('/api/analyze-team', async (req, res) => {
  try {
    const staticRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: FPL_HEADERS });
    if (!staticRes.ok) {
      return res.status(staticRes.status).json({ error: 'Failed to fetch FPL data' });
    }
    const data = await staticRes.json();
    res.json(data);
  } catch (error) {
    console.error('Error in analyze-team GET:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: Fetch General FPL Bootstrap Data
app.get('/api/bootstrap-static', async (req, res) => {
  try {
    const response = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: FPL_HEADERS
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `FPL API returned status ${response.status}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching FPL bootstrap static:', error);
    res.status(500).json({ error: 'Failed to fetch data from FPL API' });
  }
});

// Catch-all Proxy Route
app.get('/api/proxy/*', async (req, res) => {
  const targetPath = req.params[0];
  const targetUrl = `https://fantasy.premierleague.com/api/${targetPath}`;

  try {
    const response = await fetch(targetUrl, { headers: FPL_HEADERS });
    if (!response.ok) {
      return res.status(response.status).json({ error: `FPL API status: ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(`Error proxying ${targetUrl}:`, error);
    res.status(500).json({ error: 'Failed to fetch remote endpoint' });
  }
});

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
