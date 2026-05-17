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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Twelve Data fetch ─────────────────────────────────────────────────────────
async function td(endpoint, params) {
  try {
    const url = new URL(`https://api.twelvedata.com/${endpoint}`);
    url.searchParams.set('apikey', TWELVE_API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await axios.get(url.toString(), { timeout: 12000 });
    console.log(`TD ${endpoint} ${params.symbol}:`, JSON.stringify(res.data).slice(0, 100));
    return res.data;
  } catch (err) {
    console.error(`TD ${endpoint} failed:`, err.message);
    return null;
  }
}

// ── Fetch XAU/USD indicators ──────────────────────────────────────────────────
async function fetchXAU() {
  console.log('Fetching XAU/USD price...');
  const priceData = await td('price', { symbol: 'XAU/USD' });
  await sleep(1000);

  console.log('Fetching EMA9 1H...');
  const ema9_1h = await td('ema', { symbol: 'XAU/USD', interval: '1h', time_period: 9, outputsize: 1 });
  await sleep(1000);

  console.log('Fetching EMA20 1H...');
  const ema20_1h = await td('ema', { symbol: 'XAU/USD', interval: '1h', time_period: 20, outputsize: 1 });
  await sleep(1000);

  console.log('Fetching RSI 1H...');
  const rsi_1h = await td('rsi', { symbol: 'XAU/USD', interval: '1h', time_period: 14, outputsize: 1 });
  await sleep(1000);

  console.log('Fetching EMA9 4H...');
  const ema9_4h = await td('ema', { symbol: 'XAU/USD', interval: '4h', time_period: 9, outputsize: 1 });
  await sleep(1000);

  console.log('Fetching EMA20 4H...');
  const ema20_4h = await td('ema', { symbol: 'XAU/USD', interval: '4h', time_period: 20, outputsize: 1 });
  await sleep(1000);

  console.log('Fetching RSI 4H...');
  const rsi_4h = await td('rsi', { symbol: 'XAU/USD', interval: '4h', time_period: 14, outputsize: 1 });

  // Extract values safely
  const price    = priceData?.price;
  const ema9_1h_val  = ema9_1h?.values?.[0]?.ema;
  const ema20_1h_val = ema20_1h?.values?.[0]?.ema;
  const rsi_1h_val   = rsi_1h?.values?.[0]?.rsi;
  const ema9_4h_val  = ema9_4h?.values?.[0]?.ema;
  const ema20_4h_val = ema20_4h?.values?.[0]?.ema;
  const rsi_4h_val   = rsi_4h?.values?.[0]?.rsi;

  console.log(`\n📊 XAU/USD DATA:`);
  console.log(`Price: ${price}`);
  console.log(`EMA9 1H: ${ema9_1h_val} | EMA20 1H: ${ema20_1h_val} | RSI 1H: ${rsi_1h_val}`);
  console.log(`EMA9 4H: ${ema9_4h_val} | EMA20 4H: ${ema20_4h_val} | RSI 4H: ${rsi_4h_val}`);

  if (!price) throw new Error('No price data returned');
  if (!ema9_1h_val) throw new Error('No EMA9 1H data - check API key or rate limit');
  if (!rsi_1h_val)  throw new Error('No RSI 1H data - check API key or rate limit');

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
async function aiAnalyze(d) {
  const prompt = `You are XG, a professional gold trader. Strategy: EMA 9/20 crossover + RSI 14 on 1H and 4H.

Symbol: XAU/USD (Gold)
Current Price: ${d.price}

1H Chart:
- EMA 9:  ${d.ema9_1h}
- EMA 20: ${d.ema20_1h}
- RSI 14: ${d.rsi_1h}

4H Chart:
- EMA 9:  ${d.ema9_4h}
- EMA 20: ${d.ema20_4h}
- RSI 14: ${d.rsi_4h}

Trading Rules:
- BUY: EMA9 > EMA20 on BOTH timeframes AND RSI between 40-70
- SELL: EMA9 < EMA20 on BOTH timeframes AND RSI between 30-60  
- WAIT: timeframes conflict OR RSI extreme (>75 or <25)
- Stop Loss: 1.2% from entry price
- Take Profit: 2.8x the SL distance (1:2.8 RR)

Return ONLY valid JSON, no markdown, no extra text:
{"signal":"BUY","confidence":85,"entry":"${d.price}","stopLoss":"price","takeProfit":"price","riskReward":"1:2.8","sentiment":"Bullish","timeframeAlign":"1H+4H ✓","reason":"2 sentence professional analysis"}`;

  console.log('Sending to GPT-4o-mini...');

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  const raw = res.data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
  console.log('GPT Response:', raw);
  return JSON.parse(raw);
}

// ── ROUTE: /api/prices ────────────────────────────────────────────────────────
app.get('/api/prices', async (req, res) => {
  try {
    const data = await td('price', { symbol: 'XAU/USD' });
    res.json({ xau: data?.price || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTE: /api/analyze-all ───────────────────────────────────────────────────
app.get('/api/analyze-all', async (req, res) => {
  try {
    console.log('\n🚀 Starting XAU/USD analysis...');
    const indicators = await fetchXAU();
    const analysis   = await aiAnalyze(indicators);

    const result = {
      xau: {
        symbol: 'XAU/USD',
        ...indicators,
        ...analysis,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`\n✅ SIGNAL: ${analysis.signal} ${analysis.confidence}%`);
    res.json(result);

  } catch (err) {
    console.error('❌ Analysis failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTE: /api/analyze/xau ──────────────────────────────────────────────────
app.get('/api/analyze/xau', async (req, res) => {
  try {
    const indicators = await fetchXAU();
    const analysis   = await aiAnalyze(indicators);
    res.json({ symbol: 'XAU/USD', ...indicators, ...analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ XG TRADE AI live on port ${PORT}`));
