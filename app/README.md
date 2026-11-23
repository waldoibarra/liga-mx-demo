# Liga MX simulator

Compare two Apertura 2026 playoff scenarios without changing the completed regular season.

From the project root, run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory app
```

Open [the local dashboard](http://127.0.0.1:8765/). Use the local server rather than opening the HTML file directly.

Each scenario runs in its own browser worker. Canceling one preserves its last completed result and does not interrupt the other.

Run the engine regression checks with `node --test app/engine.test.mjs`.

[`season.json`](season.json) owns the frozen match snapshot. [`engine.mjs`](engine.mjs) owns the scoring models and playoff rules.
