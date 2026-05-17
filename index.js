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

const SYMBOLS = {
  xau: 'XAU/USD',
  btc: 'BTC/USD',
  eth: 'ETH/USD',
  eur: 'EUR/USD',
  gbp: 'GBP/USD'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Safe value extractor ──────────────────────────────────────────────────────
function extractValue(data, type) {
  try {
    if (!data) return null;
    if (data.status === 'error') return null;
    // indicators return { values: [{ema/rsi: "..."}, ...] }
    if (data.values && Array.isArray(data.values) && data.values.length > 0) {
      return data.values[0][type] || null;
    }
    // price returns { price: "..." }
    if (data.price) return data.price;
    return null;
  } catch {
    return null;
  }
}

// ── Twelve Data fetch ─────────────────────────────────────────────────────────
async function td(endpoint, params) {
  try {
    const url = new URL(`https://api.twelvedata.com/${endpoint}`);
    url.searchParams.set('apikey', TWELVE_API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await axios.get(url.toString(), { timeout: 12000 });
    return res.data;
  } catch (err) {
    console.error(`TD ${endpoint} failed:`, err.message);
    return null;
  }
}

// ── Fetch all indicators for one symbol safely ────────────────────────────────
async function fetchIndicators(symbol) {
  const priceData = await td('price', { symbol });
  await sleep(800);
  const ema9_1h = await td('ema', { symbol, interval: '1h', time_period: 9, outputsize: 1 });
  await sleep(800);
  const ema20_1h = await td('ema', { symbol, interval: '1h', time_period: 20, outputsize: 1 });
  await sleep(800);
  const rsi_1h = await td('rsi', { symbol, interval: '1h', time_period: 14, outputsize: 1 });
  await sleep(800);
  const ema9_4h = await td('ema', { symbol, interval: '4h', time_period: 9, outputsize: 1 });
  await sleep(800);
  const ema20_4h = await td('ema', { symbol, interval: '4h', time_period: 20, outputsize: 1 });
  await sleep(800);
  const rsi_4h = await td('rsi', { symbol, interval: '4h', time_period: 14, outputsize: 1 });

  const price    = extractValue(priceData, 'price')    || priceData?.price;
  const ema9_1h_val  = extractValue(ema9_1h, 'ema');
  const ema20_1h_val = extractValue(ema20_1h, 'ema');
  const rsi_1h_val   = extractValue(rsi_1h, 'rsi');
  const ema9_4h_val  = extractValue(ema9_4h, 'ema');
  const ema20_4h_val = extractValue(ema20_4h, 'ema');
  const rsi_4h_val   = extractValue(rsi_4h, 'rsi');

  // Log for debugging
  console.log(`${symbol} → price:${price} ema9_1h:${ema9_1h_val} rsi_1h:${rsi_1h_val}`);

  if (!price || !ema9_1h_val || !ema20_1h_val || !rsi_1h_val) {
    throw new Error(`Incomplete data for ${symbol}`);
  }

  return {
    price,
    ema9_1h:  ema9_1h_val,
    ema20_1h: ema20_1h_val,
    rsi_1h:   rsi_1h_val,
    ema9_4h:  ema9_4h_val  || ema9_1h_val,
    ema20_4h: ema20_4h_val || ema20_1h_val,
    rsi_4h:   rsi_4h_val   || rsi_1h_val
  };
}

// ── GPT-4o-mini AI analysis ───────────────────────────────────────────────────
async function aiAnalyze(symbol, d) {
  const prompt = `You are XG, a professional institutional trader. Strategy: EMA 9/20 crossover + RSI 14 on 1H and 4H.

Symbol: ${symbol}
Price: ${d.price}
1H — EMA9: ${d.ema9_1h}, EMA20: ${d.ema20_1h}, RSI: ${d.rsi_1h}
4H — EMA9: ${d.ema9_4h}, EMA20: ${d.ema20_4h}, RSI: ${d.rsi_4h}

Rules:
- BUY: EMA9 > EMA20 on both TFs, RSI 40-70
- SELL: EMA9 < EMA20 on both TFs, RSI 30-60
- WAIT: conflict or RSI extreme
- SL: 1.2% for XAU/BTC/ETH, 0.3% for forex
- TP: 2.8x SL

Return ONLY valid JSON no markdown:
{"signal":"BUY","confidence":85,"entry":"${d.price}","stopLoss":"price","takeProfit":"price","riskReward":"1:2.8","sentiment":"Bullish","timeframeAlign":"1H+4H ✓","reason":"2 sentence analysis"}`;

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API}`, 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );

  const raw = res.data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── ROUTE: /api/prices ────────────────────────────────────────────────────────
app.get('/api/prices', async (req, res) => {
  try {
    const results = {};
    for (const [key, symbol] of Object.entries(SYMBOLS)) {
      const data = await td('price', { symbol });
      results[key] = data?.price || null;
      await sleep(300);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTE: /api/analyze-all ───────────────────────────────────────────────────
app.get('/api/analyze-all', async (req, res) => {
  const results = {};

  for (const [sym, symbol] of Object.entries(SYMBOLS)) {
    try {
      console.log(`\n🔍 Analyzing ${symbol}...`);
      const indicators = await fetchIndicators(symbol);
      await sleep(1000);
      const analysis = await aiAnalyze(symbol, indicators);

      results[sym] = { symbol, ...indicators, ...analysis };
      console.log(`✅ ${symbol}: ${analysis.signal} ${analysis.confidence}%`);

    } catch (err) {
      console.error(`❌ ${sym}: ${err.message}`);
      results[sym] = { error: err.message };
    }

    // 3 second gap between assets
    await sleep(3000);
  }

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ XG TRADE AI live on port ${PORT}`));
