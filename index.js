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
const OPENAI_API = process.env.OPENAI_API_KEY;

const symbols = {
  xau: 'XAU/USD',
  btc: 'BTC/USD',
  eth: 'ETH/USD',
  eur: 'EUR/USD',
  gbp: 'GBP/USD'
};

// ── HELPER: Twelve Data fetch ─────────────────────────────────────────────────
async function td(endpoint, params) {
  const url = new URL(`https://api.twelvedata.com/${endpoint}`);
  url.searchParams.set('apikey', TWELVE_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await axios.get(url.toString(), { timeout: 10000 });
  return res.data;
}

// ── HELPER: GPT-4o-mini AI analysis ──────────────────────────────────────────
async function aiAnalyze(symbol, price, ema9, ema20, rsi, ema9_4h, ema20_4h, rsi_4h) {
  const prompt = `
You are XG, a professional institutional forex and gold trader.
Your strategy: EMA 9/20 crossover on 1H and 4H with RSI 14 filter.

Analyze this market data and return a trade signal:

Symbol: ${symbol}
Current Price: ${price}

1H Indicators:
- EMA 9:  ${ema9}
- EMA 20: ${ema20}
- RSI 14: ${rsi}

4H Indicators:
- EMA 9:  ${ema9_4h}
- EMA 20: ${ema20_4h}
- RSI 14: ${rsi_4h}

Rules:
- BUY only if EMA 9 > EMA 20 on BOTH timeframes AND RSI between 40-70
- SELL only if EMA 9 < EMA 20 on BOTH timeframes AND RSI between 30-60
- WAIT if timeframes conflict or RSI is extreme (>75 or <25)
- Confluence across 1H and 4H increases confidence
- Stop loss: 1.2% from entry for XAU/BTC/ETH, 0.3% for forex pairs
- Take profit: 2.8x the stop loss distance (1:2.8 RR)

Return ONLY this exact JSON, no extra text, no markdown:
{
  "signal": "BUY" or "SELL" or "WAIT",
  "confidence": number between 0 and 100,
  "entry": "price as string",
  "stopLoss": "price as string",
  "takeProfit": "price as string",
  "riskReward": "1:x",
  "sentiment": "Bullish" or "Bearish" or "Neutral",
  "timeframeAlign": "1H+4H ✓" or "1H only" or "4H only" or "No conf.",
  "reason": "2-3 sentence professional analysis explaining the signal"
}
`;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 350
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  const raw   = response.data.choices[0].message.content.trim();
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── ROUTE: GET /api/prices ────────────────────────────────────────────────────
app.get('/api/prices', async (req, res) => {
  try {
    const results = {};
    for (const key in symbols) {
      try {
        const data = await td('price', { symbol: symbols[key] });
        results[key] = data.price || null;
      } catch {
        results[key] = null;
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

// ── ROUTE: GET /api/analyze/:sym ──────────────────────────────────────────────
app.get('/api/analyze/:sym', async (req, res) => {
  try {
    const sym    = req.params.sym.toLowerCase();
    const symbol = symbols[sym];
    if (!symbol) return res.status(400).json({ error: 'Unknown symbol' });

    const [
      priceData,
      ema9_1h, ema20_1h, rsi_1h,
      ema9_4h, ema20_4h, rsi_4h
    ] = await Promise.all([
      td('price', { symbol }),
      td('ema', { symbol, interval: '1h', time_period: 9,  outputsize: 1 }),
      td('ema', { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
      td('rsi', { symbol, interval: '1h', time_period: 14, outputsize: 1 }),
      td('ema', { symbol, interval: '4h', time_period: 9,  outputsize: 1 }),
      td('ema', { symbol, interval: '4h', time_period: 20, outputsize: 1 }),
      td('rsi', { symbol, interval: '4h', time_period: 14, outputsize: 1 })
    ]);

    const price  = priceData.price;
    const ema9   = ema9_1h.values[0].ema;
    const ema20  = ema20_1h.values[0].ema;
    const rsi    = rsi_1h.values[0].rsi;
    const ema9f  = ema9_4h.values[0].ema;
    const ema20f = ema20_4h.values[0].ema;
    const rsif   = rsi_4h.values[0].rsi;

    const analysis = await aiAnalyze(symbol, price, ema9, ema20, rsi, ema9f, ema20f, rsif);

    res.json({
      symbol, price,
      ema9, ema20, rsi,
      ema9_4h: ema9f, ema20_4h: ema20f, rsi_4h: rsif,
      ...analysis,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Analyze error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTE: GET /api/analyze-all ───────────────────────────────────────────────
app.get('/api/analyze-all', async (req, res) => {
  const results = {};

  for (const sym of Object.keys(symbols)) {
    try {
      const symbol = symbols[sym];

      const [
        priceData,
        ema9_1h, ema20_1h, rsi_1h,
        ema9_4h, ema20_4h, rsi_4h
      ] = await Promise.all([
        td('price', { symbol }),
        td('ema', { symbol, interval: '1h', time_period: 9,  outputsize: 1 }),
        td('ema', { symbol, interval: '1h', time_period: 20, outputsize: 1 }),
        td('rsi', { symbol, interval: '1h', time_period: 14, outputsize: 1 }),
        td('ema', { symbol, interval: '4h', time_period: 9,  outputsize: 1 }),
        td('ema', { symbol, interval: '4h', time_period: 20, outputsize: 1 }),
        td('rsi', { symbol, interval: '4h', time_period: 14, outputsize: 1 })
      ]);

      const price  = priceData.price;
      const ema9   = ema9_1h.values[0].ema;
      const ema20  = ema20_1h.values[0].ema;
      const rsi    = rsi_1h.values[0].rsi;
      const ema9f  = ema9_4h.values[0].ema;
      const ema20f = ema20_4h.values[0].ema;
      const rsif   = rsi_4h.values[0].rsi;

      const analysis = await aiAnalyze(symbol, price, ema9, ema20, rsi, ema9f, ema20f, rsif);

      results[sym] = {
        symbol, price,
        ema9, ema20, rsi,
        ema9_4h: ema9f, ema20_4h: ema20f, rsi_4h: rsif,
        ...analysis
      };

    } catch (err) {
      console.error(`${sym} failed:`, err.message);
      results[sym] = { error: err.message };
    }
  }

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`XG TRADE AI live on port ${PORT}`);
});
