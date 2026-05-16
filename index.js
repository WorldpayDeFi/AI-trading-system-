const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TWELVE_API = process.env.TWELVEDATA_API_KEY;
const FINNHUB_API = process.env.FINNHUB_API_KEY;
const OPENAI_API = process.env.OPENAI_API_KEY;

const symbols = {
  xau: 'XAU/USD',
  btc: 'BTC/USD',
  eth: 'ETH/USD',
  eur: 'EUR/USD',
  gbp: 'GBP/USD'
};

// GET LIVE MARKET DATA
app.get('/api/prices', async (req, res) => {
  try {

    const results = {};

    for (const key in symbols) {

      const symbol = symbols[key];

      const response = await axios.get(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_API}`
      );

      results[key] = response.data.price;
    }

    res.json(results);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      error: 'Failed to fetch prices'
    });
  }
});

// GET NEWS SENTIMENT
app.get('/api/news/:symbol', async (req, res) => {

  try {

    const symbol = req.params.symbol.toUpperCase();

    const response = await axios.get(
      `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API}`
    );

    res.json(response.data.slice(0, 5));

  } catch (err) {
    console.error(err.message);

    res.status(500).json({
      error: 'News fetch failed'
    });
  }
});

// AI ANALYSIS
app.post('/api/analyze', async (req, res) => {

  try {

    const { marketData } = req.body;

    const prompt = `
You are a professional AI trading analyst.

Analyze this market data:

${JSON.stringify(marketData)}

Return:
- signal (BUY / SELL / WAIT)
- confidence %
- reason
- stop loss
- take profit
- risk reward
`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      analysis: response.data.choices[0].message.content
    });

  } catch (err) {

    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: 'AI analysis failed'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`XG TRADE AI running on port ${PORT}`);
});
