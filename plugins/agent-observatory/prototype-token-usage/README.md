# Agent Observatory token-usage prototype

> THROWAWAY PROTOTYPE — this is not production plugin code.

Question: how should a single-workspace Agent Observatory show token usage by model and let users inspect usage for each agent?

Run from the Emerald City repository root:

```powershell
python -m http.server 4173 --directory plugins\agent-observatory\prototype-token-usage
```

Then compare:

- <http://localhost:4173/?variant=bars> — model bars plus selected-agent turn chart
- <http://localhost:4173/?variant=table> — ranked usage ledger with expandable agents
- <http://localhost:4173/?variant=timeline> — workspace token timeline with agent pulldown

Use the floating switcher or left/right arrow keys. All usage data is simulated and held in memory.

The prototype treats cached input as a subset of input tokens. Displayed totals therefore use `input + output`, not `input + cached input + output`. Context-window utilization is displayed separately because it is a current context reading, not cumulative token usage.
