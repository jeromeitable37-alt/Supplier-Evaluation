---
name: create-skill
description: "Use when packaging a repeatable workflow, debugging method, review checklist, or implementation pattern into a reusable SKILL.md for this repo or a personal profile."
---

# Create a Reusable Skill

Use this workflow to turn a process into a discoverable, reusable skill that can guide future work consistently.

## Goal

Produce a file named `SKILL.md` that captures:
- the step-by-step process
- decision points and branching logic
- quality criteria and completion checks
- when the workflow should and should not be used

## Scope Decision

Choose the correct location before writing anything.

- Workspace-scoped: use for team or repo-specific workflows, stored under `.github/skills/<skill-name>/SKILL.md`
- User-scoped: use for personal workflows, stored under the VS Code user prompts folder and not committed to the repo

If the workflow is specific to this project, prefer the workspace scope unless the user explicitly wants a personal skill.

## Extraction Process

When the user has already been following a workflow, translate it into a reusable pattern.

1. Identify the underlying task or outcome.
2. List the exact steps the user follows in order.
3. Capture any decision branches such as:
   - when to escalate or stop
   - how to choose different implementation paths
   - what evidence proves the task is complete
4. Write the completion criteria in observable terms such as:
   - tests run
   - errors checked
   - output verified
   - final state confirmed

## Structure of the Skill

Use this structure:

```md
---
name: short-skill-name
description: "Use when: context for when this skill should be invoked."
---

# Skill Name

## Goal
Brief purpose of the workflow.

## When to Use
Describe the scenarios where this skill applies.

## Steps
1. Step one
2. Step two
3. Step three

## Decision Points
- If X, do Y
- If not, do Z

## Completion Checks
- Verify A
- Verify B
- Verify C

## Common Pitfalls
List failure modes and anti-patterns.
```

## Quality Bar

A good skill is:
- specific enough to be useful in the right contexts
- short enough to be scannable during live work
- action-oriented, not generic theory
- grounded in evidence and verification
- clear about both success conditions and exceptions

## Validation Checklist

Before finalizing, confirm all of the following:
- the skill has a meaningful description
- the workflow is clear and linear enough to follow
- decision logic is explicit
- completion checks are visible
- the file is stored in the correct location for its scope
- the content is reusable beyond a single conversation

## Example Prompts

These are good prompts for invoking the skill:
- Create a reusable skill for my debugging workflow
- Turn this QA checklist into a SKILL.md for the repo
- Package this implementation pattern into a reusable skill
- Draft a workspace-scoped skill for reviewing code changes

## Related Customizations

After creating a skill, consider creating one of these next:
- a project instruction for always-on repo rules
- a prompt for a single repeatable task
- a custom agent for multi-step or context-isolated work
- a hook for enforcing formatting or guardrails
