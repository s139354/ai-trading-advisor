# AI Trading Advisor Final Legend

A professional AI trading analysis platform. It includes:

- TradingView advanced chart
- AI decision center
- OpenAI integration when API key is provided
- Local expert engine fallback when no API key exists
- Risk desk
- Scenario lab
- Backtesting simulator
- Trade journal using browser localStorage
- Watchlist and market intelligence panels
- Exportable institutional report

## Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Optional real AI

Copy `.env.example` to `.env` and add your OpenAI API key:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Restart the server.

## Disclaimer

This app is educational and analytical only. It is not financial advice.
