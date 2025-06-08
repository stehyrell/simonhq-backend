const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Simon HQ backend is running.');
});

app.post('/api/partner/search', (req, res) => {
  const { category, location, filters } = req.body;
  const mockCompanies = [
    {
      id: "redbull-123",
      name: "Red Bull Sweden",
      description: "Energy drinks and extreme sports",
      category,
      location
    },
    {
      id: "monster-456",
      name: "Monster Energy",
      description: "Edgy energy drink for festivals",
      category,
      location
    }
  ];
  res.json({ companies: mockCompanies });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
