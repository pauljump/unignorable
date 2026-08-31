# Unignorable — WebMCP Challenge submission package

## Submission thesis

Unignorable turns fragmented public evidence about recurring civic conditions into one visible, accountable lifecycle: **Detected → Checked → Action → Outcome**. WebMCP makes that lifecycle operable by a person and agent sharing the same live map.

The agent does the synthesis that is tedious for a person: search a place, compare nearby public evidence, inspect recurrence and uncertainty, reconcile city closures with returns after closure, and identify the next useful transition. The person does what the agent cannot legitimately do: physically verify a condition, authorize outward communication, choose a route, and judge whether an outcome held.

This is not a chatbot bolted onto a map. The website itself exposes five bounded tools through the draft WebMCP API. Its distinctive tool compiles a real-world civic field audit: it weighs forecast uncertainty, repeated returns after official closure, lifecycle state, and walking effort to decide which human checks would create the most accountability value. Every state-changing tool opens the existing visible interface for human review.

## Why it fits the challenge

- **Shared context:** the agent and person operate the same Leaflet map, selected condition, public record, and action UI.
- **A new human-agent primitive:** instead of automating another web form, the agent allocates scarce human attention across real-world truth checks that a browser agent cannot honestly perform.
- **Less scraping, more semantics:** the agent receives structured evidence, model caveats, lifecycle state, and stable condition IDs rather than inferring meaning from markers and prose.
- **Human authority:** no tool can claim a field observation, request location permission, contact an official, create an action receipt, buy access, or publish to X.
- **Real public value:** a resident can ask one natural-language question—“What keeps happening near this block, and what can I do?”—and move from public evidence to a safe next step.
- **Progressive enhancement:** ordinary browsers retain the complete map; compatible agent browsers discover the tools from the top-level page.

## Tool surface

| Tool | Reads | Visible effect | Durable or external effect |
| --- | --- | --- | --- |
| `unignorable_find_nearby` | Seven public evidence categories near an NYC place | None | None |
| `unignorable_inspect_condition` | Forecast, uncertainty, evidence, lifecycle, record, next step | Centers map and opens forecast | None |
| `unignorable_plan_civic_field_audit` | Nearby lifecycles, uncertainty, closure contradictions, and walking effort | Renders an ordered civic field audit | None; every field claim remains human |
| `unignorable_read_current_condition` | Current map and selected lifecycle context | None | None |
| `unignorable_prepare_condition_action` | Selected condition and action context | Opens check, receipt, record, or route UI | None; a person must complete the action |

All schemas reject additional properties and bound strings, result counts, radii, and enums. Read tools carry `readOnlyHint`; outputs sourced from public or community records carry `untrustedContentHint`. Tool registration is tied to page lifetime with an `AbortController`, and executions preserve browser cancellation signals.

## Three-minute demo script

### 0:00–0:25 — The problem

Open the live map and say:

> A city can close thousands of individual tickets while the same condition keeps returning. Unignorable turns those scattered records into one condition with a memory.

Show the unobstructed map and the four-stage loop.

### 0:25–1:15 — Compile a real-world audit

In ChatGPT’s in-app browser or a WebMCP-enabled Chrome build, show the five available site tools. Ask:

> Build me a 30-minute civic field audit starting at Penn Station. Prioritize places where city closures were followed by more reports. Do not submit anything.

The agent calls `unignorable_plan_civic_field_audit`. Unignorable reconciles the nearby public records and visibly renders an ordered audit. Point out the split printed on the page: the machine ranks the evidence; humans decide what is true outside the browser.

### 1:15–1:50 — One stop, fully explained

Ask:

> Inspect the closest modeled condition. Explain what is known, what is uncertain, how many city closures were followed by another report, and the next useful step.

The agent calls `unignorable_inspect_condition`. The map visibly centers on the approximate area and opens the same forecast card the person can inspect. Emphasize that the numeric score is uncalibrated and the location is approximate.

### 1:50–2:30 — Agent prepares; human decides

Ask:

> Prepare the public share receipt, but do not post it.

The agent calls `unignorable_prepare_condition_action` with `share_receipt`. The receipt and draft open on the page. Show the returned `not_performed` list, then say:

> The same boundary holds for verification: the agent can open the check, but only a nearby person can grant proximity and submit what they actually see.

Optionally prepare `nearby_check` to show the three human choices without triggering location permission.

### 2:30–2:55 — Close the loop

Show Detected → Checked → Action → Outcome and conclude:

> WebMCP gives public evidence an agent-readable shape, while Unignorable keeps truth claims and civic action under human control. The objective is not more reports or outrage. It is more verified, durably resolved condition-days per active block.

## Suggested Devpost copy

### One-line description

An agent-readable civic accountability map that finds recurring public problems, explains their evidence and lifecycle, and prepares the next human-controlled action.

### What humans and agents can do together

A resident can ask what recurring civic evidence exists near a place and what deserves attention. The agent searches seven categories, inspects a modeled condition, explains uncertainty and the city-response history, and prepares the matching verification, accountability, sharing, or walking interface. The human remains responsible for physical observation, outward communication, and any purchase or submission.

### How WebMCP is implemented

The top-level page imperatively registers five tools with `document.modelContext.registerTool`. Tool handlers call a narrow bridge into the same application logic and APIs used by the visible map. The field-audit tool performs bounded multi-condition synthesis and renders the result in the shared page; it does not turn the agent into a witness. Inputs use bounded JSON Schemas with `additionalProperties: false`; public outputs are marked untrusted; page-view tools describe their exact UI effect; registration and execution support cancellation. The app also sends an explicit `Origin-Agent-Cluster: ?1` header and a `tools=(self)` permissions policy.

### Meaningful extension after challenge launch

The dated WebMCP implementation commit adds the tool-registration module, page bridge, browser security headers, visible agent-ready status, deterministic registration and safety tests, browser-level discovery validation, and this submission package. Preserve that commit in the public history.

## Submission checklist

- [x] Working product and deterministic tests
- [x] Imperative top-level WebMCP tools
- [x] Shared visible UI and explicit human-control boundaries
- [x] Demo script and Devpost copy
- [x] Open-source license in the local submission branch
- [ ] Deploy this WebMCP commit to the live URL
- [ ] Make the GitHub repository public (it is currently private)
- [ ] Record a public, audio-narrated demo under three minutes
- [ ] Join Devpost and submit before **September 3, 2026 at 1:00 PM PDT**

The final four items are external publication or account actions and require the owner to approve or perform them.

## References

- WebMCP draft: https://webmachinelearning.github.io/webmcp/
- OpenAI site-tools guide: https://learn.chatgpt.com/docs/webmcp
- Chrome WebMCP guide: https://developer.chrome.com/docs/ai/webmcp
- Challenge page: https://webmcp.devpost.com/
- Official rules: https://webmcp.devpost.com/rules
