const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================================
// CONFIG
// ============================================================
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || "YOUR_API_KEY_HERE";
// Secret shared with your local account_bridge.py script — set this in
// Render's environment variables too (BRIDGE_AUTH_TOKEN). Never hardcode it.
const BRIDGE_AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN || null;

// Symbols to scan (Twelve Data format). Kept to 6 to respect free-tier
// rate limits (Basic plan: ~8 requests/minute). Add more only if you've
// upgraded your Twelve Data plan.
const WATCHLIST = [
    { display: "XAUUSD", api: "XAU/USD", label: "Gold" },
    { display: "EURUSD", api: "EUR/USD", label: "Euro/Dollar" },
    { display: "GBPUSD", api: "GBP/USD", label: "Pound/Dollar" },
    { display: "USDJPY", api: "USD/JPY", label: "Dollar/Yen" },
    { display: "BTCUSD", api: "BTC/USD", label: "Bitcoin" },
    { display: "ETHUSD", api: "ETH/USD", label: "Ethereum" },
];

const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const EMA_FAST = 12;
const EMA_SLOW = 26;
const MACD_SIGNAL = 9;
const MA_TREND_PERIOD = 50;
const REFRESH_INTERVAL_MS = 60 * 1000;
const CANDLES_NEEDED = Math.max(MA_TREND_PERIOD + 5, EMA_SLOW + MACD_SIGNAL + 5);

// ============================================================
// STATE
// ============================================================
let logs = [];
let scannerCache = [];
let lastScanTime = null;
let lastScanError = null;
let accountSnapshot = null; // populated by the MT5 bridge script
let accountLastUpdate = null;

// ============================================================
// INDICATOR MATH
// ============================================================
function calculateRSI(closes, period = RSI_PERIOD) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function ema(values, period) {
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) {
        out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
}

function calculateMACD(closes) {
    if (closes.length < EMA_SLOW + MACD_SIGNAL) return null;
    const emaFast = ema(closes, EMA_FAST);
    const emaSlow = ema(closes, EMA_SLOW);
    const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
    const signalLine = ema(macdLine, MACD_SIGNAL);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return {
        macd: macdLine[macdLine.length - 1],
        signal: signalLine[signalLine.length - 1],
        histogram: histogram[histogram.length - 1],
        prevHistogram: histogram[histogram.length - 2],
    };
}

function calculateSMA(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(values.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

// Average True Range — used to size stop-loss/take-profit distance based
// on how much this symbol actually moves, rather than a fixed guess.
function calculateATR(highs, lows, closes, period = ATR_PERIOD) {
    if (closes.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);
    }
    const recent = trueRanges.slice(trueRanges.length - period);
    return recent.reduce((a, b) => a + b, 0) / period;
}

// ============================================================
// COMPOSITE SIGNAL — combines RSI + MACD + MA trend into one read.
// This is a rule-based heuristic, not a guarantee. Each condition is
// visible so you can see exactly why it reached its conclusion.
// ============================================================
function buildComposite(closes, highs, lows) {
    const price = closes[closes.length - 1];
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const ma50 = calculateSMA(closes, MA_TREND_PERIOD);
    const atr = calculateATR(highs, lows, closes);

    let bullPoints = 0, bearPoints = 0;
    const reasons = [];

    if (rsi !== null) {
        if (rsi <= 30) { bullPoints++; reasons.push(`RSI ${rsi.toFixed(1)} oversold`); }
        else if (rsi >= 70) { bearPoints++; reasons.push(`RSI ${rsi.toFixed(1)} overbought`); }
    }
    if (macd) {
        if (macd.histogram > 0 && macd.prevHistogram <= 0) { bullPoints++; reasons.push("MACD bullish crossover"); }
        else if (macd.histogram < 0 && macd.prevHistogram >= 0) { bearPoints++; reasons.push("MACD bearish crossover"); }
        else if (macd.histogram > 0) { bullPoints += 0.5; reasons.push("MACD histogram positive"); }
        else if (macd.histogram < 0) { bearPoints += 0.5; reasons.push("MACD histogram negative"); }
    }
    if (ma50 !== null) {
        if (price > ma50) { bullPoints += 0.5; reasons.push("Price above 50-period MA"); }
        else { bearPoints += 0.5; reasons.push("Price below 50-period MA"); }
    }

    let direction = "NEUTRAL";
    if (bullPoints - bearPoints >= 1.5) direction = "BUY";
    else if (bearPoints - bullPoints >= 1.5) direction = "SELL";

    let tp = null, sl = null;
    if (atr !== null && direction !== "NEUTRAL") {
        // Conservative default: SL at 1.5x ATR, TP at 2.5x ATR (~1.67 reward:risk).
        // This is a starting heuristic — adjust to your own risk tolerance
        // and backtest before trusting it with real money.
        if (direction === "BUY") {
            sl = price - atr * 1.5;
            tp = price + atr * 2.5;
        } else {
            sl = price + atr * 1.5;
            tp = price - atr * 2.5;
        }
    }

    return {
        price, rsi, macd, ma50, atr, direction,
        confidence: Math.abs(bullPoints - bearPoints),
        reasons, tp, sl,
    };
}

// ============================================================
// DATA FETCH
// ============================================================
async function fetchCandles(apiSymbol) {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(apiSymbol)}&interval=15min&outputsize=${CANDLES_NEEDED}&apikey=${TWELVE_DATA_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === "error" || !json.values) {
        throw new Error(json.message || `No data returned for ${apiSymbol}`);
    }
    const rows = json.values.slice().reverse(); // chronological order
    return {
        closes: rows.map(v => parseFloat(v.close)),
        highs: rows.map(v => parseFloat(v.high)),
        lows: rows.map(v => parseFloat(v.low)),
    };
}

async function runScan() {
    const results = [];
    for (const symbol of WATCHLIST) {
        try {
            const { closes, highs, lows } = await fetchCandles(symbol.api);
            const c = buildComposite(closes, highs, lows);
            results.push({
                display: symbol.display,
                label: symbol.label,
                price: c.price,
                rsi: c.rsi !== null ? c.rsi.toFixed(1) : "N/A",
                direction: c.direction,
                confidence: c.confidence.toFixed(1),
                reasons: c.reasons,
                tp: c.tp !== null ? c.tp.toFixed(5) : null,
                sl: c.sl !== null ? c.sl.toFixed(5) : null,
                error: null,
            });
        } catch (err) {
            results.push({
                display: symbol.display, label: symbol.label, price: null,
                rsi: "N/A", direction: "ERROR", confidence: "0", reasons: [],
                tp: null, sl: null, error: err.message,
            });
        }
        await new Promise(r => setTimeout(r, 1500)); // rate-limit friendly spacing
    }
    scannerCache = results;
    lastScanTime = new Date().toLocaleTimeString();
    lastScanError = results.every(r => r.error) ? "All symbols failed — check API key / rate limit." : null;
}

runScan();
setInterval(runScan, REFRESH_INTERVAL_MS);

// ============================================================
// UI HELPERS
// ============================================================
function signalClass(direction) {
    if (direction === "BUY") return "buy";
    if (direction === "SELL") return "sell";
    return "neutral";
}

// ============================================================
// ROUTES
// ============================================================
app.get('/', (req, res) => {
    const totalSignals = logs.length;
    const logItems = logs.length === 0
        ? `<div style="color: rgba(255,255,255,0.3); text-align: center; padding: 40px 0; font-size: 0.9rem;">Awaiting entries from MT5 EA...</div>`
        : logs.map(log => `
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); padding: 16px; margin-bottom: 12px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="color: #ff3333; font-weight: 700; font-size: 0.85rem; letter-spacing: 1px; margin-bottom: 4px;">ENTRY CAPTURED</div>
                    <div style="color: #ffffff; font-size: 0.9rem; font-family: monospace;">${JSON.stringify(log.data)}</div>
                </div>
                <div style="color: rgba(255,255,255,0.4); font-size: 0.75rem; font-family: monospace;">${log.time}</div>
            </div>
          `).join('');

    const scannerItems = scannerCache.length === 0
        ? `<div style="color: rgba(255,255,255,0.3); text-align:center; padding: 30px 0;">Scanning markets...</div>`
        : scannerCache.map(item => `
            <div class="scanner-item-full">
                <div class="scanner-row-top">
                    <div class="market-pair">${item.display} — ${item.label}</div>
                    <span class="signal-badge signal-${signalClass(item.direction)}">${item.direction}</span>
                </div>
                ${item.error
                    ? `<div class="market-meta">Error: ${item.error}</div>`
                    : `<div class="market-meta">Price: ${item.price} • RSI(14): ${item.rsi} • Confidence: ${item.confidence}/3</div>
                       ${item.tp ? `<div class="tp-sl-row"><span class="tp-tag">TP ${item.tp}</span><span class="sl-tag">SL ${item.sl}</span></div>` : ''}
                       ${item.reasons.length ? `<div class="reasons">${item.reasons.join(' • ')}</div>` : ''}`
                }
            </div>
        `).join('');

    const accountBlock = accountSnapshot ? `
        <div class="section-header">ACCOUNT (${accountSnapshot.is_demo ? 'DEMO' : 'LIVE'})</div>
        <div class="account-card">
            <div class="account-row"><span>Balance</span><span>${accountSnapshot.balance} ${accountSnapshot.currency}</span></div>
            <div class="account-row"><span>Equity</span><span>${accountSnapshot.equity} ${accountSnapshot.currency}</span></div>
            <div class="account-row"><span>Free Margin</span><span>${accountSnapshot.free_margin} ${accountSnapshot.currency}</span></div>
            <div class="account-meta">Updated: ${accountLastUpdate || '—'}</div>
        </div>
        <div class="section-header">RECENT TRADES</div>
        ${(accountSnapshot.trade_history || []).slice(0, 5).map(t => `
            <div class="trade-row">
                <div>${t.symbol} • ${t.type} • ${t.volume}</div>
                <div style="color:${t.profit >= 0 ? '#00ff88' : '#ff3333'}">${t.profit >= 0 ? '+' : ''}${t.profit}</div>
            </div>
        `).join('') || `<div class="market-meta">No recent trades.</div>`}
    ` : `
        <div class="section-header">ACCOUNT</div>
        <div class="warning-banner">Not connected yet. Run account_bridge.py on your MT5 PC to see balance and trade history here.</div>
    `;

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>GHOST WEALTH 3.0</title>
            <style>
                * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", Roboto, sans-serif; }
                body { background: #000000; color: #ffffff; margin: 0; padding: 0; display: flex; justify-content: center; min-height: 100vh; }
                .app-shell { width: 100%; max-width: 450px; background: #050505; min-height: 100vh; display: flex; flex-direction: column; position: relative; padding-bottom: 90px; overflow-y: auto; }
                .hero-banner { position: relative; padding: 40px 24px 30px 24px; background: linear-gradient(180deg, rgba(20,0,0,0.7) 0%, rgba(5,5,5,1) 100%); border-bottom: 1px solid rgba(255,255,255,0.05); }
                .mentor-badge { font-size: 0.65rem; font-weight: 800; letter-spacing: 2px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 4px; }
                .profile-title { font-size: 1.6rem; font-weight: 900; letter-spacing: 0.5px; margin: 0 0 20px 0; text-transform: uppercase; }
                .live-indicator { position: absolute; top: 35px; right: 24px; background: rgba(0, 255, 136, 0.1); border: 1px solid #00ff88; color: #00ff88; font-size: 0.7rem; font-weight: 800; padding: 4px 10px; border-radius: 20px; letter-spacing: 1px; display: flex; align-items: center; gap: 6px; }
                .live-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 8px #00ff88; }
                .headline-box { text-align: center; margin: 20px 0; }
                .headline-main { font-size: 1.4rem; font-weight: 800; color: #ffffff; }
                .engine-tag { font-size: 0.65rem; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 1.5px; margin-top: 15px; }
                .bot-version-title { font-size: 1.2rem; font-weight: 900; letter-spacing: 1px; margin-top: 2px; }
                .power-badge { display: inline-block; background: #ffffff; color: #000000; font-size: 0.6rem; font-weight: 900; padding: 6px 14px; border-radius: 20px; letter-spacing: 1px; margin-top: 15px; text-transform: uppercase; }
                .action-grid { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 12px; padding: 10px 24px 20px 24px; }
                .action-btn { background: #111111; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px 10px; text-align: center; color: #ffffff; cursor: pointer; }
                .btn-icon { font-size: 1.1rem; margin-bottom: 4px; display: block; }
                .btn-label { font-size: 0.65rem; font-weight: 800; color: rgba(255,255,255,0.6); letter-spacing: 0.5px; }
                .btn-status-toggle { background: #00ff88; border: none; }
                .btn-status-toggle .btn-icon, .btn-status-toggle .btn-label { color: #000000; font-weight: 900; }
                .app-view { display: none; padding: 0 24px; }
                .app-view.active-view { display: block; }
                .section-header { font-size: 0.7rem; font-weight: 800; color: rgba(255,255,255,0.4); padding: 15px 0 10px 0; letter-spacing: 1.5px; text-transform: uppercase; }
                .advisor-card { background: #ffffff; color: #000000; padding: 14px 16px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
                .advisor-left { display: flex; align-items: center; gap: 14px; }
                .advisor-avatar { width: 40px; height: 40px; background: #111; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
                .advisor-name { font-weight: 800; font-size: 0.95rem; }
                .standby-badge { background: #e0e4ec; color: #656e7b; font-size: 0.65rem; font-weight: 800; padding: 5px 12px; border-radius: 20px; }
                .scanner-item-full { background: #111; border: 1px solid rgba(255,255,255,0.05); padding: 14px; border-radius: 14px; margin-bottom: 10px; }
                .scanner-row-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
                .market-pair { font-weight: 700; font-size: 1rem; }
                .market-meta { font-size: 0.72rem; color: rgba(255,255,255,0.4); margin-top: 2px; }
                .reasons { font-size: 0.68rem; color: rgba(255,255,255,0.35); margin-top: 6px; font-style: italic; }
                .tp-sl-row { display: flex; gap: 10px; margin-top: 8px; }
                .tp-tag, .sl-tag { font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
                .tp-tag { background: rgba(0,255,136,0.1); color: #00ff88; }
                .sl-tag { background: rgba(255,51,51,0.1); color: #ff3333; }
                .signal-badge { padding: 6px 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap; margin-left: 10px; }
                .signal-buy { background: rgba(0, 255, 136, 0.1); color: #00ff88; border: 1px solid #00ff88; }
                .signal-sell { background: rgba(255, 51, 51, 0.1); color: #ff3333; border: 1px solid #ff3333; }
                .signal-neutral { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.15); }
                .scan-meta-bar { font-size: 0.7rem; color: rgba(255,255,255,0.3); padding: 4px 0 16px 0; }
                .account-card { background: #111; border: 1px solid rgba(255,255,255,0.05); border-radius: 14px; padding: 16px; margin-bottom: 10px; }
                .account-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 4px 0; }
                .account-meta { font-size: 0.65rem; color: rgba(255,255,255,0.3); margin-top: 6px; }
                .trade-row { display: flex; justify-content: space-between; font-size: 0.8rem; background: #0d0d0d; padding: 10px 12px; border-radius: 10px; margin-bottom: 6px; }
                .bottom-dock { position: absolute; bottom: 0; left: 0; right: 0; height: 80px; background: rgba(5, 5, 5, 0.9); backdrop-filter: blur(20px); border-top: 1px solid rgba(255,255,255,0.05); display: grid; grid-template-columns: repeat(3, 1fr); align-items: center; justify-items: center; z-index: 100; }
                .dock-item { display: flex; flex-direction: column; align-items: center; color: rgba(255,255,255,0.3); text-decoration: none; font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; cursor: pointer; background: none; border: none; width: 100%; padding: 10px 0; }
                .dock-item.active { color: #ffffff; }
                .dock-icon { font-size: 1.2rem; margin-bottom: 5px; }
                .warning-banner { background: rgba(255,180,0,0.08); border: 1px solid rgba(255,180,0,0.4); color: #ffb400; font-size: 0.72rem; padding: 10px 12px; border-radius: 10px; margin-bottom: 16px; }
            </style>
        </head>
        <body>
            <div class="app-shell">
                <div class="hero-banner">
                    <div class="live-indicator"><div class="live-dot"></div>LIVE</div>
                    <div class="mentor-badge">MENTOR</div>
                    <div class="profile-title">MISHOGOTMOTION</div>
                    <div class="headline-box">
                        <div class="headline-main" id="dynamic-headline">Neural Execution Hub</div>
                        <div class="engine-tag">MULTI-INDICATOR ENGINE • ${TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE" ? "NOT CONFIGURED" : "ACTIVE"}</div>
                        <div class="bot-version-title">GHOST WEALTH 3.0</div>
                        <div class="power-badge">REAL DATA MODE</div>
                    </div>
                </div>

                <div id="view-home" class="app-view active-view">
                    <div class="action-grid" style="padding: 10px 0 20px 0;">
                        <div class="action-btn" onclick="switchTab('scanner')">
                            <span class="btn-icon">📊</span>
                            <span class="btn-label">QUOTES</span>
                        </div>
                        <div class="action-btn btn-status-toggle">
                            <span class="btn-icon">⏸</span>
                            <span class="btn-label">PAUSE</span>
                        </div>
                        <div class="action-btn" onclick="alert('This clears local log display only.')">
                            <span class="btn-icon">🗑️</span>
                            <span class="btn-label">CLEAR LOG</span>
                        </div>
                    </div>

                    ${accountBlock}

                    <div class="section-header">LIVE TELEMETRY STREAM (${totalSignals})</div>
                    <div id="telemetry-log-box">
                        ${logItems}
                    </div>
                </div>

                <div id="view-scanner" class="app-view">
                    ${TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE" ? `<div class="warning-banner">⚠️ No API key set. Scanner will show errors.</div>` : ''}
                    <div class="warning-banner">TP/SL levels are rule-based calculations (ATR distance), not guarantees. Verify against your own analysis before trading.</div>
                    <div class="section-header">MULTI-INDICATOR SCANNER (RSI + MACD + MA TREND)</div>
                    <div class="scan-meta-bar">Last scan: ${lastScanTime || "pending"} ${lastScanError ? `• ${lastScanError}` : ''}</div>
                    ${scannerItems}
                </div>

                <div id="view-settings" class="app-view">
                    <div class="section-header">AUTOMATION COMPILER</div>
                    <div style="background: rgba(255,255,255,0.02); padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.5); font-size: 0.85rem; line-height: 1.5;">
                        Bot deployment isn't wired up yet — the scanner tab now runs real multi-indicator analysis, but nothing here places trades automatically. Ask Claude to build this next once you've verified the scanner's accuracy.
                    </div>
                </div>

                <div class="bottom-dock">
                    <button class="dock-item active" id="btn-tab-home" onclick="switchTab('home')">
                        <div class="dock-icon">🎛️</div><div>HOME</div>
                    </button>
                    <button class="dock-item" id="btn-tab-scanner" onclick="switchTab('scanner')">
                        <div class="dock-icon">🧠</div><div>SCANNER</div>
                    </button>
                    <button class="dock-item" id="btn-tab-settings" onclick="switchTab('settings')">
                        <div class="dock-icon">⚙️</div><div>BUILDER</div>
                    </button>
                </div>
            </div>

            <script>
                function switchTab(targetView) {
                    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active-view'));
                    document.querySelectorAll('.dock-item').forEach(t => t.classList.remove('active'));
                    if(targetView === 'home') {
                        document.getElementById('view-home').classList.add('active-view');
                        document.getElementById('btn-tab-home').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Neural Execution Hub";
                    } else if(targetView === 'scanner') {
                        document.getElementById('view-scanner').classList.add('active-view');
                        document.getElementById('btn-tab-scanner').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Multi-Indicator Scanner";
                    } else if(targetView === 'settings') {
                        document.getElementById('view-settings').classList.add('active-view');
                        document.getElementById('btn-tab-settings').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Automation Studio";
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ status: "Backend running", logsCount: logs.length, lastScan: lastScanTime, accountConnected: !!accountSnapshot });
});

app.get('/scan', (req, res) => {
    res.json({ lastScanTime, data: scannerCache, error: lastScanError });
});

app.post('/signal', (req, res) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.unshift({ time: timestamp, data: req.body });
    if (logs.length > 10) logs.pop();
    res.json({ status: "Signal handled successfully" });
});

// Receives account balance/equity/trade history pushed from account_bridge.py.
// Protected by a bearer token so random internet traffic can't post fake data.
app.post('/account-update', (req, res) => {
    if (!BRIDGE_AUTH_TOKEN) {
        return res.status(503).json({ error: "BRIDGE_AUTH_TOKEN not configured on server." });
    }
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${BRIDGE_AUTH_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    accountSnapshot = req.body;
    accountLastUpdate = new Date().toLocaleTimeString();
    res.json({ status: "Account snapshot received" });
});

app.get('/account', (req, res) => {
    res.json({ accountSnapshot, accountLastUpdate });
});

app.listen(PORT, () => {
    console.log(`Server active on port ${PORT}`);
    if (TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE") {
        console.warn("⚠️  TWELVE_DATA_API_KEY not set.");
    }
    if (!BRIDGE_AUTH_TOKEN) {
        console.warn("⚠️  BRIDGE_AUTH_TOKEN not set — account bridge endpoint disabled.");
    }
});
