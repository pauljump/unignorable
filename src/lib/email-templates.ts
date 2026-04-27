import { StalledProject } from "./stalled-projects"

interface EmailTemplate {
  subject: string
  body: string
}

const templates: ((project: StalledProject, cmName: string) => EmailTemplate)[] = [
  // Template 1: Direct status inquiry
  (p, cm) => ({
    subject: `Status inquiry: ${p.address}, ${p.borough} — ${p.units}-unit project stalled ${p.yearsStalled} years`,
    body: `Dear Council Member ${cm},

I'm a constituent in your district writing about a stalled housing project at ${p.address} in ${p.borough}.

This ${p.units}-unit, ${p.stories}-story building was filed with the Department of Buildings but has shown no progress in ${p.yearsStalled} years. The current status is "${p.statusDescription}."

New York City is in a housing crisis. Every stalled project means families who can't find an affordable place to live. I'd like to understand what's blocking this project and what your office can do to help move it forward.

Can you provide a status update or direct me to someone who can?

Thank you for your time.

Sincerely,
[Your name]
[Your address]`,
  }),

  // Template 2: Housing crisis framing
  (p, cm) => ({
    subject: `${p.units} housing units stalled at ${p.address} — requesting your help`,
    body: `Dear Council Member ${cm},

I live in your district and I'm reaching out about a housing project that appears to be stuck.

At ${p.address} in ${p.borough}, a ${p.stories}-story building with ${p.units} dwelling units has been in the DOB pipeline for ${p.yearsStalled} years with a status of "${p.statusDescription}." That's ${p.units} homes that New Yorkers could be living in right now.

I'm not writing to blame anyone. I understand development is complex. But as your constituent, I want to know: is there anything preventing this project from moving forward? Is there anything your office can do?

I'd appreciate any information you can share.

Best regards,
[Your name]
[Your address]`,
  }),

  // Template 3: Neighborhood impact
  (p, cm) => ({
    subject: `Stalled construction at ${p.address} — ${p.yearsStalled} years and counting`,
    body: `Dear Council Member ${cm},

I'm writing as a resident of District ${p.councilDistrict} about the stalled building project at ${p.address}.

According to DOB records, this ${p.units}-unit residential building has been in "${p.statusDescription}" status with no recent progress. The project was filed ${p.yearsStalled} years ago.

Stalled construction sites affect the entire neighborhood — they're eyesores, safety hazards, and most importantly, they represent housing that people desperately need.

Could your office look into what's holding this project up? I'd be grateful for any update.

Thank you,
[Your name]
[Your address]`,
  }),

  // Template 4: Data-driven
  (p, cm) => ({
    subject: `DOB Job #${p.jobId}: ${p.units} units stalled at ${p.address}`,
    body: `Dear Council Member ${cm},

I'm a constituent writing about DOB Job Application #${p.jobId}.

The facts:
- Location: ${p.address}, ${p.borough}
- Proposed: ${p.units} dwelling units, ${p.stories} stories
- Current DOB status: ${p.statusDescription}
- Years since last activity: ${p.yearsStalled}
- Developer: ${p.owner}

This project represents real housing supply that isn't reaching the market. In a city where vacancy rates are at historic lows, ${p.units} stalled units matters.

I'd appreciate your office investigating the status of this project and sharing what you learn.

Respectfully,
[Your name]
[Your address]`,
  }),

  // Template 5: Brief and pointed
  (p, cm) => ({
    subject: `Why is ${p.address} still stalled? (${p.units} units, ${p.yearsStalled} years)`,
    body: `Dear Council Member ${cm},

Quick question from a constituent: a ${p.units}-unit building at ${p.address} in ${p.borough} has been sitting in "${p.statusDescription}" status for ${p.yearsStalled} years.

We need housing. This project was approved. What's the holdup?

I'd appreciate any information your office can share.

Thanks,
[Your name]
[Your address]`,
  }),
]

export function getEmailTemplate(project: StalledProject, cmName: string): EmailTemplate {
  const index = Math.floor(Math.random() * templates.length)
  return templates[index](project, cmName)
}

export function buildMailtoLink(email: string, template: EmailTemplate): string {
  return `mailto:${email}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`
}
