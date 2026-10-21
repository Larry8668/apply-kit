// Shared by the content script and the settings page.
// Each field: how it's shown in settings, and how it's recognised on forms.
// p = matching priority (lower wins) so specific phrases beat generic ones.

var NOT_PERSON = /\b(company|employer|school|university|college|reference|referee|manager|emergency|recruiter|referr\w*|file|user|business|project|organi[sz]ation)\b/u;
var NOT_CONTACT = /\b(reference|referee|manager|emergency|recruiter)\b/u;

var FIELDS = [
  { key: "firstName", label: "First name", group: "Basics", p: 17, ac: ["given-name"], re: /\b(first|given|fore)\s?name\b|\bfname\b/u, not: NOT_PERSON },
  { key: "lastName", label: "Last name", group: "Basics", p: 18, ac: ["family-name"], re: /\b(last|family|sur)\s?name\b|\blname\b/u, not: NOT_PERSON },
  { key: "fullName", label: "Full name", group: "Basics", p: 19, ac: ["name"], re: /\b(full|legal|your)\s?name\b|^name$|^(candidate|applicant)\s?name$/u, not: NOT_PERSON, ph: "Leave blank to use first + last" },
  { key: "preferredName", label: "Preferred name", group: "Basics", p: 15, re: /\bpreferred\s?(first\s?)?name\b|\bnickname\b/u },
  { key: "pronouns", label: "Pronouns", group: "Basics", p: 16, re: /\bpronouns?\b/u },
  { key: "email", label: "Email", group: "Basics", p: 1, type: "email", ac: ["email"], re: /\be\s?mail\b/u, not: NOT_CONTACT },
  { key: "phone", label: "Phone", group: "Basics", p: 5, type: "tel", ac: ["tel", "tel-national"], re: /\b(phone|mobile|cell|telephone)\b/u, not: NOT_CONTACT },

  { key: "address", label: "Street address", group: "Location", p: 24, ac: ["street-address", "address-line1"], re: /\b(street|address)\b/u, not: /\b(e\s?mail|web|ip)\b/u },
  { key: "city", label: "City", group: "Location", p: 22, ac: ["address-level2"], re: /\b(city|town)\b/u },
  { key: "state", label: "State / province", group: "Location", p: 23, ac: ["address-level1"], re: /\b(state|province|county|region)\b/u },
  { key: "postalCode", label: "Postal / ZIP code", group: "Location", p: 20, ac: ["postal-code"], re: /\b(zip|postal|post\s?code|pin\s?code)\b/u },
  { key: "country", label: "Country", group: "Location", p: 21, ac: ["country", "country-name"], re: /\bcountry\b/u, not: /\bcode\b/u },

  { key: "linkedin", label: "LinkedIn URL", group: "Links", p: 2, type: "url", re: /\blinked\s?in\b/u },
  { key: "github", label: "GitHub URL", group: "Links", p: 3, type: "url", re: /\bgit\s?hub\b/u },
  { key: "website", label: "Website or portfolio", group: "Links", p: 4, type: "url", ac: ["url"], re: /\b(website|portfolio|personal\s?(site|url|page)|blog|url)\b/u },

  { key: "currentTitle", label: "Current job title", group: "Work", p: 13, ac: ["organization-title"], re: /\b(current|recent|present|latest)\s?(job\s?)?(title|role|position)\b|^(job\s?)?title$/u },
  { key: "currentCompany", label: "Current company", group: "Work", p: 14, ac: ["organization"], re: /\b(current|recent|present|latest)\s?(company|employer)\b|^(company|employer)(\s?name)?$/u },
  { key: "yearsExperience", label: "Years of experience", group: "Work", p: 11, max: 40, re: /\byears?\b.*\bexperience\b|\bexperience\b.*\byears?\b/u, ph: "e.g. 5" },
  { key: "salary", label: "Salary expectation", group: "Work", p: 10, re: /\b(salary|compensation|ctc|pay\s?expectations?)\b/u, ph: "e.g. 120000" },
  { key: "noticePeriod", label: "Notice period / start date", group: "Work", p: 12, re: /\b(notice\s?period|start\s?date|available\s?to\s?start|earliest\s?start|availability)\b/u, ph: "e.g. 2 weeks" },

  { key: "workAuth", label: "Authorized to work here?", group: "Common questions", p: 7, re: /\b(authori[sz]ed|eligible|right|legally\s?able)\s?to\s?work\b|\bwork\s?(authori[sz]ation|permit|eligibility)\b/u, ph: "Yes" },
  { key: "sponsorship", label: "Need visa sponsorship?", group: "Common questions", p: 6, re: /\bsponsor(ship)?\b/u, ph: "No" },
  { key: "relocate", label: "Willing to relocate?", group: "Common questions", p: 8, re: /\brelocat/u, ph: "Yes" },
  { key: "heardAbout", label: "How you heard about jobs", group: "Common questions", p: 9, re: /\bhow\s?did\s?you\s?(hear|find|learn)\b|\breferral\s?source\b/u, ph: "e.g. LinkedIn" }
];

var MATCH_ORDER = FIELDS.slice().sort((a, b) => a.p - b.p);

function normalize(s) {
  return String(s || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Hosted application platforms. Their forms are often embedded in a company's
// careers page as an iframe from another site, which is expected.
var PLATFORM = /(^|\.)(greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|taleo\.net|bamboohr\.com|jobvite\.com|workable\.com|teamtailor\.com|personio\.(de|com)|successfactors\.(com|eu)|wellfound\.com|rippling\.com|rippling-ats\.com)$/u;

// Rough "same site" check: jobs.acme.com and acme.com match, and so do
// a.acme.co.uk and b.acme.co.uk.
function siteOf(host) {
  const p = String(host || "").toLowerCase().split(".");
  const n = p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? 3 : 2;
  return p.slice(-n).join(".");
}
