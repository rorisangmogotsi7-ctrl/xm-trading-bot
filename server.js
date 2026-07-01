const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let logs = [];

// The main web interface
app.get('/', (req, res) => {
    const totalSignals = logs.length;
    const logItems = logs.length === 0 
        ? `<div style="color: #666; text-align: center; padding: 40px 0;">Awaiting connections from MT5...</div>`
        : logs.map(log => `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 16px; margin-bottom: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="color: #00ff88; font-weight: 600; font-size: 0.95rem; margin-bottom: 4px;">SIGNAL RECEIVED</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 0.85rem; font-family: monospace;">${JSON.stringify(log.data)}</div>
                </div>
                <div style="color: rgba(255,255,255,0.4); font-size: 0.8rem; font-family: monospace;">${log.time}</div>
            </div>
          `).join('');

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>EA NEXUS Dashboard</title>
            <style>
                * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                body { background: #07090e; color: #ffffff; margin: 0; padding: 0; display: flex; justify-content: center; background-image: radial-gradient(circle at 50% -20%, #1a233a 0%, #07090e 70%); min-height: 100vh; }
                
                /* Mobile App Container */
                .app-container { width: 100%; max-width: 450px; background: #0d111a; min-height: 100vh; display: flex; flex-direction: column; position: relative; border-left: 1px solid rgba(255,255,255,0.05); border-right: 1px solid rgba(255,255,255,0.05); padding-bottom: 90px; }
                
                /* Header / Hero Section */
                .hero-section { padding: 30px 24px; text-align: center; position: relative; }
                .brand-title { font-size: 0.8rem; letter-spacing: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 24px; font-weight: 600; }
                
                /* Status Ring Visual */
                .status-ring-container { width: 200px; height: 200px; margin: 0 auto 24px auto; position: relative; display: flex; align-items: center; justify-content: center; }
                .status-ring { width: 100%; height: 100%; border-radius: 50%; background: radial-gradient(circle, #182848 0%, #0d111a 100%); border: 4px solid #00ff88; box-shadow: 0 0 30px rgba(0, 255, 136, 0.2), inset 0 0 20px rgba(0, 255, 136, 0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
                .ring-subtitle { font-size: 0.75rem; color: rgba(255,255,255,0.5); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
                .ring-main-status { font-size: 1.25rem; font-weight: bold; letter-spacing: 1px; color: #ffffff; text-shadow: 0 0 10px rgba(255,255,255,0.5); }
                
                /* Action Grid Quick Info */
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 24px; margin-bottom: 24px; }
                .info-card { background: #141a29; border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 16px; text-align: center; }
                .info-label { font-size: 0.75rem; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
                .info-value { font-size: 1.2rem; font-weight: 600; color: #00e5ff; }
                
                /* Logs Section */
                .section-title { font-size: 0.9rem; font-weight: 600; color: rgba(255,255,255,0.6); padding: 0 24px; margin-bottom: 12px; letter-spacing: 0.5px; }
                .logs-list { padding: 0 24px; flex-grow: 1; }
                
                /* App Bottom Navigation Bar */
                .bottom-nav { position: absolute; bottom: 0; left: 0; right: 0; height: 75px; background: rgba(13, 17, 26, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-top: 1px solid rgba(255,255,255,0.05); display: grid; grid-template-columns: repeat(4, 1fr); align-items: center; justify-items: center; }
                .nav-item { display: flex; flex-direction: column; align-items: center; color: rgba(255,255,255,0.4); text-decoration: none; font-size: 0.7rem; font-weight: 500; letter-spacing: 0.5px; }
                .nav-item.active { color: #00e5ff; }
                .nav-icon { font-size: 1.3rem; margin-bottom: 4px; }
            </style>
        </head>
        <body>

            <div class="app-container">
                <div class="hero-section">
                    <div class="brand-title">EA NEXUS</div>
                    <div class="status-ring-container">
                        <div class="status-ring">
                            <span class="ring-subtitle">SYSTEM STATUS</span>
                            <span class="ring-main-status">ROBOT ACTIVE</span>
                        </div>
                    </div>
                </div>

                <div class="info-grid">
                    <div class="info-card">
                        <div class="info-label">SERVER</div>
                        <div class="info-value" style="color: #00ff88;">ONLINE</div>
                    </div>
                    <div class="info-card">
                        <div class="info-label">TOTAL SIGNALS</div>
                        <div class="info-value">${totalSignals}</div>
                    </div>
                </div>

                <div class="section-title">NEURAL ENGINE LOGS</div>
                <div class="logs-list">
                    ${logItems}
                </div>

                <div class="bottom-nav">
                    <a href="#" class="nav-item active">
                        <div class="nav-icon">⌂</div>
                        <div>HOME</div>
                    </a>
                    <a href="#" class="nav-item">
                        <div class="nav-icon">📊</div>
                        <div>SYMBOLS</div>
                    </a>
                    <a href="#" class="nav-item">
                        <div class="nav-icon">📈</div>
                        <div>STATS</div>
                    </a>
                    <a href="#" class="nav-item">
                        <div class="nav-icon">⚙</div>
                        <div>SETTINGS</div>
                    </a>
                </div>
            </div>

        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ status: "Backend running", logsCount: logs.length });
});

app.post('/signal', (req, res) => {
    const timestamp = new Date().toLocaleTimeString();
    console. Harris = "Received signal", req.body;
    
    logs.unshift({ time: timestamp, data: req.body });
    if (logs.length > 15) logs.pop(); 
    
    res.json({ status: "Signal received successfully" });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
