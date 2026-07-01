const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint for Render & Cron-job
app.get('/health', (req, res) => {
    res.json({ status: "Backend running" });
});

// Signal endpoint for your MT5 EA
app.post('/signal', (req, res) => {
    console.log("Received trading signal:", req.body);
    res.json({ status: "Signal received successfully" });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
