# Availability Reminder Email — flow

End-to-end lifecycle of the WiDS NYC availability-reminder pipeline,
showing where the new email template
(`assets/emails/template/availability-reminder.{html,txt}`) and the new
`availability-chase` Step 5 plug into the existing operator-driven send
flow.

- ★ = new / changed in this PR
- ◇ = pre-existing infrastructure

## Flow

```mermaid
flowchart TD
  %% ── Day 0 ──
  subgraph S0["Day 0 — prep meeting opens"]
    direction TB
    start_meeting["◇ /wids-meeting-start (operator)<br/>INSERT meetings (status='prep')<br/>Gmail MCP → plain-text blast<br/>'submit by &lt;+7d&gt;'"]
    initial_submit["◇ Member visits /availability<br/>INSERT availability rows"]
    start_meeting --> initial_submit
  end

  initial_submit -->|responded| done_responded([done])
  initial_submit -->|no response| chase

  %% ── Daily chase ──
  subgraph S1["Day 7+ — daily availability-chase task"]
    direction TB
    chase["◇ Step 1+2<br/>SELECT prep meetings &gt; 7d old<br/>compute responded / total"]
    chase_decide{response &lt; 50%<br/>AND last alert &gt; 5d ago?}
    alert["◇ Step 3 — alert OPERATOR<br/>Gmail MCP → operator inbox<br/>★ body now references<br/>the templated reminder"]
    log_alert[(◇ command_log<br/>'Sent low-response alert')]
    chase --> chase_decide
    chase_decide -->|no| chase_skip([skip until tomorrow])
    chase_decide -->|yes| alert --> log_alert
  end

  log_alert --> op_decide

  %% ── Operator decision ──
  op_decide{Operator reply}
  op_decide -->|wait| wait_exit([no send this round])
  op_decide -->|remind<br/>remind subject='…'| step5

  %% ── Step 5 ──
  subgraph S3["★ Step 5 — operator 'remind' follow-up"]
    direction TB
    step5["★ 5a resolve subject (default or override)<br/>★ 5b SQL fetch meeting + paper, stats,<br/>non-responders"]
    foreach[/for each non-responder/]
    render["★ 5c.1 read template files<br/>availability-reminder.html<br/>availability-reminder.txt"]
    substitute["★ 5c.2 substitute 16 Mustache tokens"]
    idem{5c.3 already sent<br/>this meeting × member?}
    send["★ 5c.4 Gmail MCP → member<br/>HTML body + plain-text body"]
    log_send[(★ command_log<br/>'Sent reminder meeting=… member=…')]
    summary["★ 5d summary to operator<br/>'Sent reminders to N non-responders'"]
    step5 --> foreach --> render --> substitute --> idem
    idem -->|yes| skip_member([skip this member])
    idem -->|no| send --> log_send
    skip_member --> summary
    log_send --> summary
  end

  summary --> member_open

  %% ── Member responds ──
  subgraph S4["Member responds to reminder"]
    direction TB
    member_open["◇ Member opens email<br/>clicks magenta 'Open availability'"]
    member_submit["◇ Lands on /availability (auth-gated)<br/>INSERT availability rows"]
    member_open --> member_submit
  end

  member_submit -.->|next daily run| chase
  chase -.->|enough days covered| schedule["◇ /wids-schedule-reading-group<br/>pick date + book Calendar event"]

  %% ── Styling ──
  classDef new fill:#fdeaf3,stroke:#c8226d,color:#1a1814
  classDef existing fill:#eef4f0,stroke:#365c4b,color:#1a1814
  classDef decision fill:#faf8f4,stroke:#6d6757,color:#1a1814
  classDef db fill:#ffffff,stroke:#8e8674,color:#4f4a3e
  classDef terminal fill:#ffffff,stroke:#d2c8b4,color:#8e8674

  class start_meeting,initial_submit,chase,alert,member_open,member_submit,schedule existing
  class step5,foreach,render,substitute,idem,send,summary new
  class log_send db
  class log_alert db
  class chase_decide,op_decide decision
  class done_responded,chase_skip,wait_exit,skip_member terminal
```

## Components touched

| Component | Role | Status |
|---|---|---|
| `/wids-meeting-start` (slash command) | sends Day-0 initial availability blast | ◇ pre-existing |
| `web/app/availability/page.tsx` | portal page where members submit days | ◇ pre-existing |
| `scheduled_tasks/availability-chase.md` Steps 1–4 | daily low-response alert to operator | ◇ pre-existing |
| `scheduled_tasks/availability-chase.md` Step 5 | per-recipient render + send | ★ new |
| `assets/emails/template/availability-reminder.html` | high-fidelity templated reminder | ★ new |
| `assets/emails/template/availability-reminder.txt` | plain-text alternative | ★ new |
| `command_log` | idempotency keys (`meeting=X`, `member=Y`) | ◇ used / ★ new write site |
| Gmail MCP | actual SMTP send | ◇ pre-existing |
| `meetings`, `members`, `availability`, `papers` | merge-data sources | ◇ pre-existing |

## Why operator-in-the-loop

The scheduled task **never auto-emails members**. It always alerts the
operator first; the operator approves with `remind` (or
`remind subject="…"`) to authorise the send. This mirrors the existing
`availability-chase` design and prevents the bot from speaking with
Michelle's voice without her consent.

## Idempotency

Step 5c.3's `command_log LIKE '%reminder meeting=<id> member=<id>%'` check
guarantees that re-running Step 5 — including partial-failure retries
mid-loop — never double-sends a reminder to the same person for the same
meeting. Each successful send writes a row keyed by `meeting × member`.
