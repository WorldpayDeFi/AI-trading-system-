const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const OpenAI = require('openai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYMBOL_MAP = {
  xau: 'XAU/USD',
  btc: 'BTC/USD',
  eth: 'ETH/USD',
  eur: 'EUR/USD',
  gbp: 'GBP/USD'
};

// GET LIVE PRICE
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = SYMBOL_MAP[req.params.symbol.toLowerCase()];

    const response = await axios.get(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${process.env.TWELVEDATA_API_KEY}`
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET NEWS SENTIMENT
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    const response = await axios.get(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=2026-05-01&to=2026-05-15&token=${process.env.FINNHUB_API_KEY}`
    );

    res.json(response.data.slice(0, 5));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI TRADE ANALYSIS
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, price, news } = req.body;

    const prompt = `
You are a professional institutional trading AI.

Analyze this market:

Symbol: ${symbol}
Current Price: ${price}
News Headlines: ${JSON.stringify(news)}

Return ONLY valid JSON:

{
  "signal": "BUY or SELL or WAIT",
  "confidence": 0-100,
  "reason": "short explanation",
  "entry": "price",
  "stopLoss": "price",
  "takeProfit": "price",
  "riskReward": "1:x"
}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.4
    });

    const result = completion.choices[0].message.content;

    res.json(JSON.parse(result));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('XG TRADE AI running on port 3000');
});
