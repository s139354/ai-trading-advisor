import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/index.html");
});

const num = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function classifyVolatility(atr, price) {
  if (!atr || !price) return { label: "Unknown", score: 50, ratio: null };
  const ratio = (atr / price) * 100;
  if (ratio < 0.25) return { label: "Low", score: 66, ratio };
  if (ratio < 1.2) return { label: "Moderate", score: 78, ratio };
  if (ratio < 3.5) return { label: "High", score: 53, ratio };
  return { label: "Extreme", score: 34, ratio };
}

function localExpertEngine(input) {
  const symbol = String(input.symbol || "FX:XAUUSD").trim().toUpperCase();
  const price = num(input.price, 0);
  const atr = num(input.atr, price * 0.006);
  const support = num(input.support, price - atr * 2.2);
  const resistance = num(input.resistance, price + atr * 2.2);
  const rsi = num(input.rsi, 50);
  const fastMa = num(input.fastMa, price);
  const slowMa = num(input.slowMa, price);
  const equity = Math.max(1, num(input.equity, 10000));
  const riskPct = clamp(num(input.riskPct, 1), 0.05, 10);
  const rr = clamp(num(input.rr, 2), 0.5, 8);
  const spread = Math.max(0, num(input.spread, 0));
  const marketType = input.marketType || "Forex";
  const timeframe = input.timeframe || "Intraday";
  const notes = String(input.notes || "").trim();

  let bullish = 0;
  let bearish = 0;
  const reasons = [];
  const warnings = [];

  if (fastMa > slowMa) { bullish += 20; reasons.push("Fast moving average is above slow moving average, supporting bullish trend continuation."); }
  if (fastMa < slowMa) { bearish += 20; reasons.push("Fast moving average is below slow moving average, supporting bearish trend continuation."); }
  if (rsi >= 55 && rsi <= 68) { bullish += 14; reasons.push("RSI is bullish but not extremely overbought."); }
  if (rsi <= 45 && rsi >= 32) { bearish += 14; reasons.push("RSI is bearish but not extremely oversold."); }
  if (rsi > 72) { bearish += 12; warnings.push("RSI is very high; buying may be late and reversal risk is elevated."); }
  if (rsi < 28) { bullish += 12; warnings.push("RSI is very low; selling may be late and bounce risk is elevated."); }
  if (price > resistance) { bullish += 18; reasons.push("Price is trading above resistance, suggesting breakout pressure."); }
  if (price < support) { bearish += 18; reasons.push("Price is trading below support, suggesting breakdown pressure."); }
  if (price > support && price < resistance) reasons.push("Price is inside the main structure range, so confirmation is important.");
  if (notes.length > 20) reasons.push("Trader notes were considered as qualitative context.");

  const volatility = classifyVolatility(atr, price);
  if (volatility.label === "Extreme") warnings.push("Volatility is extreme; reduce risk or wait for cleaner structure.");
  if (volatility.label === "High") warnings.push("High ATR environment; wider stops and smaller position size are recommended.");
  if (spread && price && spread / price > 0.0015) warnings.push("Spread/cost is relatively high compared with price.");

  const edge = bullish - bearish;
  let decision = "WAIT";
  if (edge >= 16) decision = "BUY";
  if (edge <= -16) decision = "SELL";

  const baseStopDistance = Math.max(atr * 1.35 + spread, price * 0.0025);
  const entry = price;
  const stopLoss = decision === "BUY" ? entry - baseStopDistance : decision === "SELL" ? entry + baseStopDistance : null;
  const riskPerUnit = stopLoss ? Math.abs(entry - stopLoss) : null;
  const target1 = decision === "BUY" ? entry + riskPerUnit * rr : decision === "SELL" ? entry - riskPerUnit * rr : null;
  const target2 = decision === "BUY" ? entry + riskPerUnit * rr * 1.5 : decision === "SELL" ? entry - riskPerUnit * rr * 1.5 : null;
  const target3 = decision === "BUY" ? entry + riskPerUnit * rr * 2.2 : decision === "SELL" ? entry - riskPerUnit * rr * 2.2 : null;
  const riskAmount = equity * (riskPct / 100);
  const units = riskPerUnit ? riskAmount / riskPerUnit : 0;
  const exposure = units * entry;
  const exposurePct = (exposure / equity) * 100;
  const breakEvenWinRate = 100 / (1 + rr);

  if (exposurePct > 800) warnings.push("Nominal exposure is very high relative to equity; use contract-specific lot sizing carefully.");
  if (riskPct > 2) warnings.push("Risk percentage is aggressive for a single trade.");
  if (decision === "WAIT") warnings.push("No clear directional edge; wait for breakout, pullback confirmation, or stronger confluence.");

  const confidence = clamp(48 + Math.abs(edge) * 1.15 + (volatility.score - 50) * 0.28 - warnings.length * 4, 20, 94);
  const grade = confidence >= 80 ? "A" : confidence >= 68 ? "B" : confidence >= 55 ? "C" : "D";

  const scenarios = [
    { name: "Conservative", riskPct: Math.max(0.25, riskPct * 0.5), rr: Math.max(1.2, rr * 0.8) },
    { name: "Balanced", riskPct, rr },
    { name: "Aggressive", riskPct: Math.min(5, riskPct * 1.5), rr: Math.min(8, rr * 1.35) }
  ].map(s => ({
    ...s,
    riskAmount: equity * (s.riskPct / 100),
    expectedWin: equity * (s.riskPct / 100) * s.rr,
    breakEvenWinRate: 100 / (1 + s.rr)
  }));

  const backtest = simulateBacktest({ confidence, rr, riskPct, equity });

  return {
    source: hasOpenAI ? "Local Expert Engine Fallback" : "Local Expert Engine",
    symbol,
    marketType,
    timeframe,
    decision,
    confidence: Math.round(confidence),
    grade,
    entry,
    stopLoss,
    targets: [target1, target2, target3],
    risk: { equity, riskPct, riskAmount, units, exposure, exposurePct, riskPerUnit, rr, breakEvenWinRate },
    structure: { support, resistance, rsi, fastMa, slowMa, atr, volatility },
    reasons,
    warnings,
    checklist: [
      { item: "Trend alignment", status: fastMa !== slowMa ? "PASS" : "NEUTRAL" },
      { item: "RSI location", status: rsi > 25 && rsi < 75 ? "PASS" : "WARNING" },
      { item: "Volatility control", status: volatility.label === "Extreme" ? "WARNING" : "PASS" },
      { item: "Risk per trade", status: riskPct <= 2 ? "PASS" : "WARNING" },
      { item: "Structure confirmation", status: decision === "WAIT" ? "WAIT" : "PASS" }
    ],
    scenarios,
    backtest,
    aiNarrative: buildNarrative(symbol, decision, confidence, grade, reasons, warnings, timeframe)
  };
}

function simulateBacktest({ confidence, rr, riskPct, equity }) {
  const trades = 36;
  const winRate = clamp(38 + confidence * 0.42, 40, 78);
  let balance = equity;
  let peak = equity;
  let maxDrawdown = 0;
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < trades; i++) {
    const pseudo = Math.abs(Math.sin((i + 1) * 12.9898 + confidence * 0.017) * 43758.5453) % 1;
    const isWin = pseudo * 100 < winRate;
    const risk = balance * (riskPct / 100);
    if (isWin) { balance += risk * rr * (0.72 + pseudo * 0.55); wins++; }
    else { balance -= risk * (0.75 + pseudo * 0.45); losses++; }
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, ((peak - balance) / peak) * 100);
  }
  return {
    trades,
    wins,
    losses,
    winRate: Math.round((wins / trades) * 100),
    estimatedReturnPct: Math.round(((balance - equity) / equity) * 1000) / 10,
    endingBalance: balance,
    maxDrawdown: Math.round(maxDrawdown * 10) / 10,
    profitFactor: Math.round(((wins * rr) / Math.max(1, losses)) * 100) / 100
  };
}

function buildNarrative(symbol, decision, confidence, grade, reasons, warnings, timeframe) {
  return `The model classifies ${symbol} as ${decision} on the ${timeframe} context with a ${confidence}% confidence score and grade ${grade}. The decision is based on trend structure, RSI position, volatility, support/resistance behavior, and risk controls. ${reasons.slice(0,3).join(" ")} ${warnings.length ? "Key caution: " + warnings[0] : "No critical warning was detected from the supplied inputs."}`;
}

function normalizeAiJson(raw, fallback) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    return { ...fallback, ...parsed, source: "OpenAI + Local Risk Engine" };
  } catch {
    return fallback;
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, openaiEnabled: hasOpenAI });
});

app.post("/api/analyze", async (req, res) => {
  const fallback = localExpertEngine(req.body || {});
  if (!hasOpenAI) return res.json(fallback);

  try {
    const prompt = `You are a professional trading risk analyst. Analyze this setup and return ONLY valid JSON. Keep all numeric risk levels realistic. Do not promise profit. Required JSON keys: decision, confidence, grade, reasons, warnings, aiNarrative. Input: ${JSON.stringify(req.body)} Local baseline: ${JSON.stringify({ decision: fallback.decision, confidence: fallback.confidence, levels: { entry: fallback.entry, stopLoss: fallback.stopLoss, targets: fallback.targets }, risk: fallback.risk })}`;
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Return compact valid JSON only. This is educational analysis, not financial advice." },
        { role: "user", content: prompt }
      ],
      temperature: 0.35
    });
    const text = completion.choices?.[0]?.message?.content || "";
    const merged = normalizeAiJson(text, fallback);
    res.json(merged);
  } catch (error) {
    fallback.source = "Local Expert Engine Fallback - OpenAI request failed";
    fallback.warnings.unshift("OpenAI request failed, so the local expert engine produced this analysis.");
    res.json(fallback);
  }
});

app.listen(PORT, () => {
  console.log(`AI Trading Advisor Final Legend running on http://localhost:${PORT}`);
  console.log(`OpenAI enabled: ${hasOpenAI ? "yes" : "no"}`);
});