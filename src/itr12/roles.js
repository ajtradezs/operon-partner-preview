/* Roles for the ITR12 workflow. Labels are firm-neutral; the register's own labels are mapped at build time
   (REGISTER.labelMap, shown on the Controls page). The client never signs in: the client acts only through the PaperSync portal. */
const ROLES = ['Tax Consultant', 'Administrator', 'Integration Administrator', 'Information Officer', 'Records/Compliance Owner'];
const ROLE_INFO = {
  'Tax Consultant': 'Owns the substantive tax gates: SARS details (G02), calculation (G05), final submission approval (G09), Declaration Alert and verification responses (G10, G11), ITA34 approval (G13) and remedies (G15). Handles the AI gates’ exceptions (G04, G08, G12).',
  Administrator: 'Owns permanent client and KYC approval (G01), onboarding requests and reminders. Manages people and roles.',
  'Integration Administrator': 'Owns the SARS integration checks (G18) together with the substantive gate owner, the transaction log and manual fallback.',
  'Information Officer': 'Owns security and privacy incidents (G17): containment, investigation, remediation and the notification assessment.',
  'Records/Compliance Owner': 'Owns retention and legal-hold release (G16) and approves policy overrides. The register splits this into a Records Owner and a Compliance Owner; the preview uses one role until Johan confirms.',
};
const PEOPLE0 = [
  { id: 'TC1', name: 'Ayesha Patel', role: 'Tax Consultant', email: 'ayesha@acacia-demo.example', note: 'Registered tax practitioner', mfa: 'On', last: 'Today 08:52' },
  { id: 'TC2', name: 'Pieter van Wyk', role: 'Tax Consultant', email: 'pieter@acacia-demo.example', note: 'Registered tax practitioner', mfa: 'On', last: 'Today 08:15' },
  { id: 'AD1', name: 'Lerato Khumalo', role: 'Administrator', email: 'lerato@acacia-demo.example', note: '', mfa: 'On', last: 'Today 08:40' },
  { id: 'IA1', name: 'Sipho Dlamini', role: 'Integration Administrator', email: 'sipho@acacia-demo.example', note: '', mfa: 'On', last: 'Today 07:58' },
  { id: 'IO1', name: 'Thandi Mahlangu', role: 'Information Officer', email: 'thandi@acacia-demo.example', note: 'POPIA Information Officer', mfa: 'On', last: 'Fri 6 Nov 16:20' },
  { id: 'RC1', name: 'Megan Jacobs', role: 'Records/Compliance Owner', email: 'megan@acacia-demo.example', note: '', mfa: 'On', last: 'Today 08:05' },
];
// The person you act as for each role in the demo.
const ME_BY_ROLE = { 'Tax Consultant': 'TC1', Administrator: 'AD1', 'Integration Administrator': 'IA1', 'Information Officer': 'IO1', 'Records/Compliance Owner': 'RC1' };

// Segregation of duties. The engine enforces each rule and audits every refusal; the Controls page lists them.
const SOD = [
  { id: 'sod-g18', text: 'G18 needs two different people: the Integration Administrator and the substantive gate owner (the Tax Consultant).' },
  { id: 'sod-override', text: 'An override is approved by the Records/Compliance Owner, who must not be the person who asked for it.' },
  { id: 'sod-severity', text: 'Lowering an S1 or S2 severity is approved by the Records/Compliance Owner, who must not be the person who asked for it.' },
  { id: 'sod-secondary', text: 'Where the register names a secondary reviewer, a different person from the resolver closes the exception.' },
  { id: 'sod-g09', text: 'Only a human Tax Consultant can release G09. No system or AI may approve it.' },
  { id: 'sod-portal', text: 'The client gates (G03, G06 and G14) pass only through the client’s own PaperSync portal action, and G07 (version freeze) only through Operon itself.' },
  { id: 'sod-fallback', text: 'A manual fallback is reconciled by a different person from the one who recorded it.' },
];

// The register's labels and what the preview shows instead (generated with the register; the firm prefix shows as [firm]).
const roleLabelMap = () => REGISTER.labelMap.slice();
