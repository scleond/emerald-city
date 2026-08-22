# Agent Observatory scope prototype

> THROWAWAY PROTOTYPE — this is not production plugin code.

Question: should Agent Observatory focus on one selected workspace, or show every workspace on the selected Paseo host?

Run from the Emerald City repository root:

```powershell
python -m http.server 4173 --directory plugins\agent-observatory\prototype
```

Then open:

- <http://localhost:4173/?variant=single> — one selected workspace
- <http://localhost:4173/?variant=all> — all workspaces on the host

Use the floating switcher or the left/right arrow keys to compare them. All data and interactions are simulated in memory.
