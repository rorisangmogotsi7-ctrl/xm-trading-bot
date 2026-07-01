const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let logs = [];

// Main App Controller UI
app.get('/', (req, res) => {
    const totalSignals = logs.length;
    const logItems = logs.length === 0 
        ? `<div style="color: rgba(255,255,255,0.3); text-align: center; padding: 40px 0; font-size: 0.9rem;">Awaiting algorithmic entries...</div>`
        : logs.map(log => `
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); padding: 16px; margin-bottom: 12px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="color: #ff3333; font-weight: 700; font-size: 0.85rem; letter-spacing: 1px; margin-bottom: 4px;">ENTRY CAPTURED</div>
                    <div style="color: #ffffff; font-size: 0.9rem; font-family: monospace;">${JSON.stringify(log.data)}</div>
                </div>
                <div style="color: rgba(255,255,255,0.4); font-size: 0.75rem; font-family: monospace;">${log.time}</div>
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
                
                /* Main Application Container Frame */
                .app-shell { width: 100%; max-width: 450px; background: #050505; min-height: 100vh; display: flex; flex-direction: column; position: relative; padding-bottom: 90px; overflow-y: auto; }
                
                /* Premium Dynamic Header Banner */
                .hero-banner { 
                    position: relative; 
                    padding: 40px 24px 30px 24px; 
                    background: linear-gradient(180deg, rgba(20,0,0,0.7) 0%, rgba(5,5,5,1) 100%), url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=600&auto=format&fit=crop');
                    background-size: cover;
                    background-position: center;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                
                .mentor-badge { font-size: 0.65rem; font-weight: 800; letter-spacing: 2px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 4px; }
                .profile-title { font-size: 1.6rem; font-weight: 900; letter-spacing: 0.5px; margin: 0 0 20px 0; text-transform: uppercase; }
                
                .live-indicator { position: absolute; top: 35px; right: 24px; background: rgba(0, 255, 136, 0.1); border: 1px solid #00ff88; color: #00ff88; font-size: 0.7rem; font-weight: 800; padding: 4px 10px; border-radius: 20px; letter-spacing: 1px; display: flex; align-items: center; gap: 6px; }
                .live-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 8px #00ff88; }
                
                .headline-box { text-align: center; margin: 20px 0; }
                .headline-main { font-size: 1.4rem; font-weight: 800; color: #ffffff; }
                .engine-tag { font-size: 0.65rem; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 1.5px; margin-top: 15px; }
                .bot-version-title { font-size: 1.2rem; font-weight: 900; letter-spacing: 1px; margin-top: 2px; }
                .power-badge { display: inline-block; background: #ffffff; color: #000000; font-size: 0.6rem; font-weight: 900; padding: 6px 14px; border-radius: 20px; letter-spacing: 1px; margin-top: 15px; text-transform: uppercase; }
                
                /* Action Menu Row Quick-buttons */
                .action-grid { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 12px; padding: 10px 24px 20px 24px; }
                .action-btn { background: #111111; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px 10px; text-align: center; color: #ffffff; cursor: pointer; }
                .btn-icon { font-size: 1.1rem; margin-bottom: 4px; display: block; }
                .btn-label { font-size: 0.65rem; font-weight: 800; color: rgba(255,255,255,0.6); letter-spacing: 0.5px; }
                .btn-status-toggle { background: #00ff88; border: none; }
                .btn-status-toggle .btn-icon, .btn-status-toggle .btn-label { color: #000000; font-weight: 900; }
                
                /* Component Views Switch Panel Styles */
                .app-view { display: none; padding: 0 24px; }
                .app-view.active-view { display: block; }
                
                .section-header { font-size: 0.7rem; font-weight: 800; color: rgba(255,255,255,0.4); padding: 15px 0 10px 0; letter-spacing: 1.5px; text-transform: uppercase; }
                
                /* Asset Row Card Component */
                .advisor-card { background: #ffffff; color: #000000; padding: 14px 16px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
                .advisor-left { display: flex; align-items: center; gap: 14px; }
                .advisor-avatar { width: 40px; height: 40px; background: #111; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
                .advisor-name { font-weight: 800; font-size: 0.95rem; }
                .standby-badge { background: #e0e4ec; color: #656e7b; font-size: 0.65rem; font-weight: 800; padding: 5px 12px; border-radius: 20px; }
                
                /* Multi-Market Grid Lists */
                .scanner-item { background: #111; border: 1px solid rgba(255,255,255,0.05); padding: 14px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                .market-pair { font-weight: 700; font-size: 1rem; }
                .market-meta { font-size: 0.75rem; color: rgba(255,255,255,0.4); margin-top: 2px; }
                .signal-badge { padding: 6px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px; }
                .signal-buy { background: rgba(0, 255, 136, 0.1); color: #00ff88; border: 1px solid #00ff88; }
                .signal-sell { background: rgba(255, 51, 51, 0.1); color: #ff3333; border: 1px solid #ff3333; }
                
                /* Bot Creator Custom Inputs Layout */
                .form-group { margin-bottom: 16px; }
                .form-group label { display: block; font-size: 0.75rem; font-weight: 700; color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
                .form-group input, .form-group select { width: 100%; background: #111; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px; color: #fff; font-size: 0.9rem; }
                .submit-bot-btn { width: 100%; background: #00ff88; color: #000; font-weight: 800; padding: 14px; border-radius: 12px; border: none; font-size: 0.9rem; cursor: pointer; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
                
                /* Sticky Bottom Navigation dock structure */
                .bottom-dock { position: absolute; bottom: 0; left: 0; right: 0; height: 80px; background: rgba(5, 5, 5, 0.9); backdrop-filter: blur(20px); border-top: 1px solid rgba(255,255,255,0.05); display: grid; grid-template-columns: repeat(3, 1fr); align-items: center; justify-items: center; z-index: 100; }
                .dock-item { display: flex; flex-direction: column; align-items: center; color: rgba(255,255,255,0.3); text-decoration: none; font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; cursor: pointer; background: none; border: none; width: 100%; padding: 10px 0; }
                .dock-item.active { color: #ffffff; }
                .dock-icon { font-size: 1.2rem; margin-bottom: 5px; }
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
                        <div class="engine-tag">NEURAL ENGINE • ACTIVE</div>
                        <div class="bot-version-title">GHOST WEALTH 3.0</div>
                        <div class="power-badge">POWERED BY ELITE EA</div>
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
                        <div class="action-btn" onclick="alert('System secure: master parameters active.')">
                            <span class="btn-icon">🗑️</span>
                            <span class="btn-label">DELETE</span>
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
                    <div class="section-header">REAL-TIME CHART SCANNER (ALL MARKETS)</div>
                    
                    <div class="scanner-item">
                        <div>
                            <div class="market-pair">XAUUSD (GOLD)</div>
                            <div class="market-meta">Forex Spot • H1 Interval</div>
                        </div>
                        <span class="signal-badge signal-buy">STRONG BUY</span>
                    </div>

                    <div class="scanner-item">
                        <div>
                            <div class="market-pair">EURUSD</div>
                            <div class="market-meta">Forex Currency • M15 Interval</div>
                        </div>
                        <span class="signal-badge signal-sell">SELL CONFLICT</span>
                    </div>

                    <div class="scanner-item">
                        <div>
                            <div class="market-pair">BTCUSD (BITCOIN)</div>
                            <div class="market-meta">Crypto Asset • H4 Interval</div>
                        </div>
                        <span class="signal-badge signal-buy">BUY ENTRY</span>
                    </div>

                    <div class="scanner-item">
                        <div>
                            <div class="market-pair">US30 (DOW JONES)</div>
                            <div class="market-meta">Indices Market • Daily View</div>
                        </div>
                        <span class="signal-badge signal-sell">STRONG SELL</span>
                    </div>
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
                                <option value="US30">US30 (Wall Street Indices)</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Strategy Blueprint Protocol</label>
                            <select id="bot-strategy">
                                <option value="Neural Scanner">Neural Engine RSI Scanner</option>
                                <option value="Moving Average Breakout">Moving Average Ribbon Breakout</option>
                                <option value="Smart Money Concepts">SMC Order Block Liquidations</option>
                            </select>
                        </div>

                        <button class="submit-bot-btn" onclick="compileCustomBot()">Compile Automation Engine</button>
                    </div>
                </div>

                <div class="bottom-dock">
                    <button class="dock-item active" id="btn-tab-home" onclick="switchTab('home')">
                        <div class="dock-icon">🎛️</div>
                        <div>HOME</div>
                    </button>
                    <button class="dock-item" id="btn-tab-scanner" onclick="switchTab('scanner')">
                        <div class="dock-icon">🧠</div>
                        <div>SCANNER</div>
                    </button>
                    <button class="dock-item" id="btn-tab-settings" onclick="switchTab('settings')">
                        <div class="dock-icon">⚙️</div>
                        <div>BUILDER</div>
                    </button>
                </div>
            </div>

            <script>
                function switchTab(targetView) {
                    // Hide all view panels
                    document.querySelectorAll('.app-view').forEach(view => {
                        view.classList.remove('active-view');
                    });
                    // Deactivate tab highlighted styling states
                    document.querySelectorAll('.dock-item').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    
                    // Route to matching panel configurations
                    if(targetView === 'home') {
                        document.getElementById('view-home').classList.add('active-view');
                        document.getElementById('btn-tab-home').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Neural Execution Hub";
                    } else if(targetView === 'scanner') {
                        document.getElementById('view-scanner').classList.add('active-view');
                        document.getElementById('btn-tab-scanner').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Cross-Market Scanner Feed";
                    } else if(targetView === 'settings') {
                        document.getElementById('view-settings').classList.add('active-view');
                        document.getElementById('btn-tab-settings').classList.add('active');
                        document.getElementById('dynamic-headline').innerText = "Automation Studio Framework";
                    }
                }

                function compileCustomBot() {
                    const name = document.getElementById('bot-name').value || "CUSTOM BOT";
                    const asset = document.getElementById('bot-asset').value;
                    const strategy = document.getElementById('bot-strategy').value;
                    
                    alert('🚀 Strategy Matrix Initialized!\\n\\nDeploying ' + name + ' to actively scan ' + asset + ' using the ' + strategy + ' script protocol framework.');
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ status: "Backend running", logsCount: logs.length });
});

app.post('/signal', (req, res) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log("Incoming automated signal trigger captured:", req.body);
    
    logs.unshift({ time: timestamp, data: req.body });
    if (logs.length > 10) logs.pop(); 
    
    res.json({ status: "Signal handled successfully" });
});

app.listen(PORT, () => {
    console.log(`Premium hub server active on port ${PORT}`);
});
