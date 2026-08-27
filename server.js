import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend can access this backend
app.use(cors());
app.use(express.json());

// Standard Headers to avoid FPL API blocking cloud data centers (403 Forbidden)
const FPL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://fantasy.premierleague.com/'
};

// Endpoint 1: Fetch General FPL Bootstrap Data (Players, Teams, Gameweeks)
app.get('/api/bootstrap-static', async (req, res) => {
  try {
    const response = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: FPL_HEADERS
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `FPL API returned status ${response.status}` 
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching FPL bootstrap static:', error);
    res.status(500).json({ error: 'Failed to fetch data from FPL API' });
  }
});

// Endpoint 2: Fetch Manager Details
app.get('/api/entry/:id', async (req, res) => {
  const managerId = req.params.id;
  try {
    const response = await fetch(`https://fantasy.premierleague.com/api/entry/${managerId}/`, {
      headers: FPL_HEADERS
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Manager not found or FPL returned ${response.status}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching manager data:', error);
    res.status(500).json({ error: 'Failed to fetch manager data' });
  }
});

// Endpoint 3: Dynamic Proxy for any other endpoint
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
