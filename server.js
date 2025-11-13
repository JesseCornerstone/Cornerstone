const express = require('express');
const path = require('path');

const app = express();

// health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Simple server listening on port ${PORT}`);
});
