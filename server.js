const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================================
// CONFIG
// ============================================================
// Get a free API key at https://twelvedata.com/pricing (Basic/free tier).
// Free tier is rate-limited (~8 requests/minute, 800/day as of writing —
// check current limits on their site before relying on this).
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || "YOUR_API_KEY_HERE";

// Symbols to scan. Twelve Data symbol format: EUR/USD, XAU/USD, BTC/USD, etc.
// Indices like US30/DJI are often NOT on the free tier — check availability
// before assuming this works for every symbol.
const WATCHLIST = [
    { display: "XAUUSD", api: "XAU/USD", label: "Gold" },
    { display: "EURUSD", api: "EUR/USD", label: "Euro/Dollar" },
    { display: "BTCUSD", api: "BTC/USD", label: "Bitcoin" },
];

const RSI_PERIOD = 14;
const REFRESH_INTERVAL_MS = 60 * 1000; // 60s — stay within free rate limits

// ============================================================
// STATE
// ============================================================
let logs = [];
let scannerCache = []; // holds the latest real computed signals
let lastScanTime = null;
let lastScanError = null;

// ============================================================
// RSI CALCULATION (Wilder's method, standard implementation)
// ============================================================
function calculateRSI(closes, period = RSI_PERIOD) {
    if (closes.length < period + 1) return null;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function classifySignal(rsi) {
    if (rsi === null) return { label: "NO DATA", cls: "neutral" };
    if (rsi <= 30) return { label: "OVERSOLD (BUY WATCH)", cls: "buy" };
    if (rsi >= 70) return { label: "OVERBOUGHT (SELL WATCH)", cls: "sell" };
    return { label: "NEUTRAL", cls: "neutral" };
}

// ============================================================
// DATA FETCH — real market data via Twelve Data time_series endpoint
// ============================================================
async function fetchCloses(apiSymbol) {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(apiSymbol)}&interval=15min&outputsize=${RSI_PERIOD + 10}&apikey=${TWELVE_DATA_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.status === "error" || !json.values) {
        throw new Error(json.message || `No data returned for ${apiSymbol}`);
    }
    // API returns most-recent-first; reverse to chronological order for RSI math
    return json.values.map(v => parseFloat(v.close)).reverse();
}

async function runScan() {
    const results = [];
    for (const symbol of WATCHLIST) {
        try {
            const closes = await fetchCloses(symbol.api);
            const rsi = calculateRSI(closes);
            const signal = classifySignal(rsi);
            const lastPrice = closes[closes.length - 1];

            results.push({
                display: symbol.display,
                label: symbol.label,
                price: lastPrice,
                rsi: rsi !== null ? rsi.toFixed(1) : "N/A",
                signal: signal.label,
                signalClass: signal.cls,
                error: null,
            });
        } catch (err) {
            results.push({
                display: symbol.display,
                label: symbol.label,
                price: null,
                rsi: "N/A",
                signal: "DATA ERROR",
                signalClass: "neutral",
                error: err.message,
            });
        }
        // small delay between calls to be gentle on free-tier rate limits
        await new Promise(r => setTimeout(r, 1500));
    }
    scannerCache = results;
    lastScanTime = new Date().toLocaleTimeString();
    lastScanError = results.every(r => r.error) ? "All symbols failed — check API key / rate limit." : null;
}

// Run once at boot, then on an interval. If the API key isn't set,
// this will populate every row with an error instead of pretending to work.
runScan();
setInterval(runScan, REFRESH_INTERVAL_MS);

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
            <div class="scanner-item">
                <div>
                    <div class="market-pair">${item.display} — ${item.label}</div>
                    <div class="market-meta">${item.error ? `Error: ${item.error}` : `Price: ${item.price} • RSI(14): ${item.rsi}`}</div>
                </div>
                <span class="signal-badge signal-${item.signalClass}">${item.signal}</span>
            </div>
        `).join('');

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
                .scanner-item { background: #111; border: 1px solid rgba(255,255,255,0.05); padding: 14px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                .market-pair { font-weight: 700; font-size: 1rem; }
                .market-meta { font-size: 0.72rem; color: rgba(255,255,255,0.4); margin-top: 2px; }
                .signal-badge { padding: 6px 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap; margin-left: 10px; }
                .signal-buy { background: rgba(0, 255, 136, 0.1); color: #00ff88; border: 1px solid #00ff88; }
                .signal-sell { background: rgba(255, 51, 51, 0.1); color: #ff3333; border: 1px solid #ff3333; }
                .signal-neutral { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.15); }
                .scan-meta-bar { font-size: 0.7rem; color: rgba(255,255,255,0.3); padding: 4px 0 16px 0; }
                .form-group { margin-bottom: 16px; }
                .form-group label { display: block; font-size: 0.75rem; font-weight: 700; color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
                .form-group input, .form-group select { width: 100%; background: #111; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px; color: #fff; font-size: 0.9rem; }
                .submit-bot-btn { width: 100%; background: #00ff88; color: #000; font-weight: 800; padding: 14px; border-radius: 12px; border: none; font-size: 0.9rem; cursor: pointer; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
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
                        <div class="engine-tag">RSI ENGINE • ${TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE" ? "NOT CONFIGURED" : "ACTIVE"}</div>
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
                        <div class="action-btn" onclick="alert('This clears local log display only — no live trading is affected.')">
                            <span class="btn-icon">🗑️</span>
                            <span class="btn-label">CLEAR LOG</span>
                        </div>
                    </div>

                    <div class="section-header">MY ACTIVE ADVISORS <span style="background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 4px; margin-left: 4px;">1</span></div>
                    <div class="advisor-card">
                        <div class="advisor-left">
                            <div class="advisor-avatar">💀</div>
                            <div class="advisor-name">GHOST WEALTH 3.0</div>
                        </div>
                        <div class="standby-badge">STANDBY</div>
                    </div>

                    <div class="section-header">LIVE TELEMETRY STREAM (${totalSignals})</div>
                    <div id="telemetry-log-box">
                        ${logItems}
                    </div>
                </div>

                <div id="view-scanner" class="app-view">
                    ${TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE" ? `<div class="warning-banner">⚠️ No API key set. Signals below are placeholders, not real data. Set TWELVE_DATA_API_KEY in your environment variables.</div>` : ''}
                    <div class="section-header">REAL-TIME RSI SCANNER</div>
                    <div class="scan-meta-bar">Last scan: ${lastScanTime || "pending"} ${lastScanError ? `• ${lastScanError}` : ''}</div>
                    ${scannerItems}
                </div>

                <div id="view-settings" class="app-view">
                    <div class="section-header">AUTOMATION COMPILER: BUILD A BOT</div>
                    <div style="background: rgba(255,255,255,0.02); padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);">
                        <div class="form-group">
                            <label>Bot Project Name</label>
                            <input type="text" id="bot-name" placeholder="e.g., GOLD ASSASSIN V1">
                        </div>
                        <div class="form-group">
                            <label>Target Execution Asset</label>
                            <select id="bot-asset">
                                <option value="XAUUSD">XAUUSD (Gold)</option>
                                <option value="EURUSD">EURUSD (Euro / Dollar)</option>
                                <option value="BTCUSD">BTCUSD (Bitcoin)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Strategy</label>
                            <select id="bot-strategy">
                                <option value="rsi_oversold">RSI Oversold/Overbought (14-period)</option>
                            </select>
                        </div>
                        <button class="submit-bot-btn" onclick="alert('This panel is a UI placeholder. It does not deploy a live strategy yet — ask Claude to wire it to the scanner if you want real automation here.')">Compile Automation Engine</button>
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
                        document.getElementById('dynamic-headline').innerText = "Live RSI Scanner Feed";
                    } else if(targetView === 'settings') {
                        document.getElementById('view-settings').classList.add('active-view');
                        document.getElementById('btn-tab-settings').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Automation Studio Framework";
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ status: "Backend running", logsCount: logs.length, lastScan: lastScanTime });
});

// Raw JSON scanner data, useful if you want your MT5 EA or another tool to pull signals too
app.get('/scan', (req, res) => {
    res.json({ lastScanTime, data: scannerCache, error: lastScanError });
});

// Webhook for your MT5 EA to post trade/signal events into the telemetry log
app.post('/signal', (req, res) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log("Incoming signal:", req.body);
    logs.unshift({ time: timestamp, data: req.body });
    if (logs.length > 10) logs.pop();
    res.json({ status: "Signal handled successfully" });
});

app.listen(PORT, () => {
    console.log(`Server active on port ${PORT}`);
    if (TWELVE_DATA_API_KEY === "YOUR_API_KEY_HERE") {
        console.warn("⚠️  TWELVE_DATA_API_KEY not set — scanner will show errors until you add it.");
    }
});
