---
name: post-mortem
description: Summarize the current session and recommend tooling improvements or additions. Use when the user invokes $post-mortem or asks what skills, tools, or process changes would have helped this session.
---

# Post-Mortem

Review the session that just happened and tell the user two things: what was
done, and what tooling would have made it faster or safer. This is an
ephemeral, read-only report — write no files, create no branches, change no
tools. If the user wants a recommendation built, that is a separate follow-up
they will ask for.

## Step 1 — Session summary

A short paragraph plus a list, not a transcript:

- what was asked and what was delivered;
- artifacts produced, with paths;
- decisions made along the way and questions still open.

## Step 2 — Friction log

Walk back through the session looking for these signals, and cite the concrete
moment that produced each one:

- ad-hoc scripts written that a tool should have provided;
- subagents spawned for work that is clearly repeatable;
- manual cross-referencing between sources that a lookup could do;
- assumptions made early that later evidence corrected — especially ones a
  cheap check would have prevented;
- stale caches, wrong docs, or two sources of truth that disagreed;
- permission detours, credential hunting, or environment surprises.

A session with no real friction is a valid finding; say so rather than
inventing recommendations.

## Step 3 — Recommendations

Before recommending anything new, check what already exists: the session's
available-skills list, the skills directories of the repos involved, and any
tool the session already used partway. Recommending an existing capability is
the failure mode this step exists to prevent.

For each friction item worth acting on, give:

- **verdict** — new skill, extend an existing tool, doc fix, or not worth
  automating;
- **where it lives** — the specific repo and directory;
- **effort** — one line;
- **evidence** — the session moment that justifies it.

Rank by expected payoff, not by how interesting the tool would be to build.
Two or three strong recommendations beat an exhaustive list.

## Step 4 — Report and stop

Present the summary, friction log, and recommendations in the final message.
Do not write files, save memories, or scaffold skills as part of this skill —
offer those as explicit follow-ups and let the user choose.
