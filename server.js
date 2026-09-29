const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running live!' });
});
app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    // Add your login logic here
    res.json({ success: true, message: "Login endpoint reached" });
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
