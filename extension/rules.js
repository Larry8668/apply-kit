// Shared by the content script and the settings page.
// Each field: how it's shown in settings, and how it's recognised on forms.
// p = matching priority (lower wins) so specific phrases beat generic ones.

var NOT_PERSON = /\b(company|employer|school|university|college|reference|referee|manager|emergency|recruiter|referr\w*|file|user|business|project|organi[sz]ation|pronounc\w*|pronunciation)\b/u;
var NOT_CONTACT = /\b(reference|referee|manager|emergency|recruiter)\b/u;
var NOT_PHONE = /\b(reference|referee|manager|emergency|recruiter|ext|extension|code|isd)\b/u;
// Current pay vs. what you're asking for. "Current CTC" must never get the expected figure.
var NOW = /\b(current|present|existing|last|latest|drawn)\b/u;
var EXPECTED = /\b(expected|expectations?|desired|asking)\b/u;

var FIELDS = [
  { key: "firstName", label: "First name", group: "Basics", p: 17, ac: ["given-name"], re: /\b(first|given|fore)\s?name\b|\bfname\b/u, not: NOT_PERSON },
  { key: "lastName", label: "Last name", group: "Basics", p: 18, ac: ["family-name"], re: /\b(last|family|sur)\s?name\b|\blname\b/u, not: NOT_PERSON },
  { key: "fullName", label: "Full name", group: "Basics", p: 19, ac: ["name"], re: /\b(full|legal|your)\s?name\b|^name$|^(candidate|applicant)\s?name$/u, not: NOT_PERSON, ph: "Leave blank to use first + last" },
  { key: "preferredName", label: "Preferred name", group: "Basics", p: 15, re: /\bpreferred\s?(first\s?)?name\b|\bnickname\b/u },
  { key: "pronouns", label: "Pronouns", group: "Basics", p: 16, re: /\bpronouns?\b/u },
  { key: "email", label: "Email", group: "Basics", p: 1, type: "email", ac: ["email"], re: /\be\s?mail\b/u, not: NOT_CONTACT },
  { key: "phone", label: "Phone", group: "Basics", p: 5, type: "tel", ac: ["tel", "tel-national"], re: /\b(phone|mobile|cell|telephone)\b/u, not: NOT_PHONE },
  { key: "phoneCode", label: "Phone country code", group: "Basics", p: 4.1, ac: ["tel-country-code"], re: /\b(country\s?(phone\s?|calling\s?|dial(ling)?\s?)?code|(phone|calling|dial(ling)?)\s?code|isd(\s?code)?)\b/u, ph: "e.g. +91" },
  { key: "phoneExt", label: "Phone extension", group: "Basics", p: 4.2, ac: ["tel-extension"], re: /\b(phone\s?)?ext(ension)?\b/u, not: /\b(file|extensions?\s?(allowed|accepted)|browser)\b/u, ph: "Leave blank if none" },

  { key: "address", label: "Street address", group: "Location", p: 24, ac: ["street-address", "address-line1"], re: /\b(street|address)\b/u, not: /\b(e\s?mail|web|ip)\b/u },
  { key: "city", label: "City", group: "Location", p: 22, ac: ["address-level2"], re: /\b(city|town)\b/u },
  { key: "state", label: "State / province", group: "Location", p: 23, ac: ["address-level1"], re: /\b(state|province|county|region)\b/u },
  { key: "postalCode", label: "Postal / ZIP code", group: "Location", p: 20, ac: ["postal-code"], re: /\b(zip|postal|post\s?code|pin\s?code)\b/u },
  { key: "country", label: "Country", group: "Location", p: 21, ac: ["country", "country-name"], re: /\bcountry\b/u, not: /\bcode\b/u },

  { key: "linkedin", label: "LinkedIn URL", group: "Links", p: 2, type: "url", re: /\blinked\s?in\b/u },
  { key: "github", label: "GitHub URL", group: "Links", p: 3, type: "url", re: /\bgit\s?hub\b/u },
  { key: "website", label: "Website or portfolio", group: "Links", p: 4, type: "url", ac: ["url"], re: /\b(website|portfolio|personal\s?(site|url|page)|blog|url)\b/u },

  { key: "currentTitle", label: "Current job title", group: "Work", p: 13, ac: ["organization-title"], re: /\b(current|recent|present|latest)\s?(job\s?)?(title|role|position)\b|^(job\s?)?title$/u, ph: "Leave blank to use your first job" },
  { key: "currentCompany", label: "Current company", group: "Work", p: 14, ac: ["organization"], re: /\b(current|recent|present|latest)\s?(company|employer)\b|^(company|employer)(\s?name)?$/u, ph: "Leave blank to use your first job" },
  { key: "yearsExperience", label: "Years of experience", group: "Work", p: 11, max: 40, re: /\byears?\b.*\bexperience\b|\bexperience\b.*\byears?\b/u, ph: "e.g. 5" },
  { key: "salary", label: "Expected salary", group: "Pay", p: 10, re: /\b(salary|compensation|ctc|pay\s?expectations?|ectc)\b/u, not: NOW, ph: "e.g. 120000" },
  { key: "salaryBreakdown", label: "Current pay breakdown", group: "Pay", p: 9.1, re: /\bbreak\s?(up|down)\b/u, not: EXPECTED, ph: "e.g. 18 LPA fixed + 2 LPA variable + ESOPs" },
  { key: "currentFixed", label: "Current fixed pay", group: "Pay", p: 9.2, re: /\bfixed\b.*\b(pay|salary|ctc|component|compensation|comp)\b|\b(pay|salary|ctc|compensation)\b.*\bfixed\b|^fixed$/u, not: EXPECTED },
  { key: "currentVariable", label: "Current variable pay / bonus", group: "Pay", p: 9.3, re: /\b(variable|bonus|incentives?)\b/u, not: EXPECTED },
  { key: "currentStock", label: "Current stock / ESOPs", group: "Pay", p: 9.4, re: /\b(esops?|rsus?|stock\s?options?|equity\s?(component|value|grant|compensation))\b/u, not: EXPECTED },
  { key: "currentSalary", label: "Current salary (total)", group: "Pay", p: 9.5, re: /\b(current|present|existing|last|latest|drawn)\s?(annual\s?|total\s?|gross\s?)?(salary|compensation|ctc|pay|package|base)\b|\bc\s?ctc\b/u, not: EXPECTED, ph: "e.g. 20 LPA" },
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

// Every value you've saved, for picking by hand when a field isn't recognised: profile
// fields in settings order, then extra fields, then saved answers.
function allDetails({ profile = {}, custom = [], work = [], edu = [], answers = [] }) {
  const out = FIELDS.filter(f => profile[f.key]).map(f => ({ group: f.group, name: f.label, value: profile[f.key] }));
  if (!profile.fullName && profile.firstName && profile.lastName) {
    out.splice(2, 0, { group: "Basics", name: "Full name", value: `${profile.firstName} ${profile.lastName}` });
  }
  work.forEach((j, i) => {
    const n = `Job ${i + 1}`;
    for (const [k, label] of [["company", "company"], ["title", "title"], ["location", "location"]]) if (j[k]) out.push({ group: "Work history", name: `${n} ${label}`, value: j[k] });
    if (j.start) out.push({ group: "Work history", name: `${n} dates`, value: showSpan(j) });
    if (j.description) out.push({ group: "Work history", name: `${n} description`, value: j.description });
  });
  edu.forEach((e, i) => {
    const n = `Education ${i + 1}`;
    for (const [k, label] of [["school", "school"], ["degree", "degree"], ["major", "field of study"], ["gpa", "grade"]]) if (e[k]) out.push({ group: "Education", name: `${n} ${label}`, value: e[k] });
    const place = [e.city, e.state, e.country].filter(Boolean).join(", ");
    if (place) out.push({ group: "Education", name: `${n} location`, value: place });
    if (e.start || e.end) out.push({ group: "Education", name: `${n} dates`, value: showSpan(e) });
  });
  for (const c of custom) if (c.value) out.push({ group: "Extra fields", name: c.label || "Extra field", value: c.value });
  for (const a of answers) if (a.a) out.push({ group: "Saved answers", name: a.q || "Saved answer", value: a.a });
  return out;
}

// ---------- Work history and education ----------
// Fields in a form's "Experience" or "Education" section are matched to one entry of your
// history instead of your profile, so a "Country" there means the job's or school's.
var WORK_SECTION = /\b(work|employment|job|professional|career)\s?(history|experience|details)\b|\bexperience\b|\bemployment\b|\bemployer\b|\bprevious\s?(jobs?|roles?|positions?)\b/u;
var EDU_SECTION = /\beducation\w*\b|\bacademic\w*\b|\bqualifications?\b|\bschools?\b|\buniversit(y|ies)\b|\bcolleges?\b/u;

// Each part: what it's called in a review, and the label pattern that finds it in a section.
var WORK_PARTS = [
  { key: "current", label: "Currently work here", re: /\b(i\s?)?(currently|still)\s?(work|employed|working)\b|\bcurrent\s?(role|job|position|employer)\b|^current$/u },
  // "From" and "To" only count at the start, so "willing to relocate" isn't an end date.
  { key: "start", label: "Start date", re: /\b(start|began|joined|joining|beginning)\b|^from\b/u },
  { key: "end", label: "End date", re: /\b(end|until|left|leaving|finish\w*)\b|^(to|till|through)\b/u },
  { key: "description", label: "Description", re: /\b(description|responsibilit\w*|summary|duties|achievements?|accomplishments?|what\s?you\s?did)\b/u },
  { key: "company", label: "Company", re: /\b(company|employer|organi[sz]ation|firm|business)\b/u },
  { key: "title", label: "Job title", re: /\b(job\s?)?(title|role|position|designation)\b/u },
  { key: "location", label: "Location", re: /\b(location|city|place|based)\b/u }
];
var EDU_PARTS = [
  { key: "current", label: "Currently studying here", re: /\b(i\s?)?(currently|still)\s?(stud\w*|enrolled|attend\w*)\b|\bcurrently\s?(here|enrolled)\b/u },
  { key: "start", label: "Start date", re: /\b(start|began|joined|beginning)\b|^from\b/u },
  { key: "end", label: "End date", re: /\b(end|until|finish\w*|graduat\w*|completion|completed|passing|passed|pass\s?out)\b|^(to|till|through)\b/u },
  { key: "school", label: "School", re: /\b(school|universit\w*|college|institut\w*|academy|alma\s?mater)\b/u },
  { key: "degree", label: "Degree", re: /\b(degree|qualification|diploma|level\s?of\s?(education|study)|program(me)?)\b/u },
  { key: "major", label: "Field of study", re: /\b(major|discipline|field\s?of\s?study|subject|speciali[sz]ation|stream|branch|course|area\s?of\s?study|concentration)\b/u },
  { key: "gpa", label: "Grade", re: /\b(gpa|cgpa|grade|percentage|marks|score|class\s?of\s?degree)\b/u },
  { key: "city", label: "City", re: /\b(city|town|location)\b/u },
  { key: "state", label: "State", re: /\b(state|province|region)\b/u },
  { key: "country", label: "Country", re: /\bcountry\b/u }
];
// Outside a section, only labels this specific are taken to mean your first school.
var EDU_ALONE = /\b(school|universit\w*|college|institut\w*)\b|\bdegree\b|\b(major|discipline|field\s?of\s?study)\b|\b(gpa|cgpa)\b|\bgraduat\w*\s?(date|year)\b|\byear\s?of\s?graduation\b/u;

// Degree names vary ("B.Tech", "Bachelor of Science"); dropdowns usually list levels.
function degreeLevel(degree) {
  const d = normalize(degree).replace(/\s+/g, "");
  if (/phd|doctor|dphil/.test(d)) return "Doctorate";
  if (/master|mtech|msc|mba|^ms$|^ma$|mca|mcom|meng|pgdm|postgrad/.test(d)) return "Master";
  if (/bachelor|btech|bsc|^ba$|^be$|bcom|bca|beng|bba|undergrad/.test(d)) return "Bachelor";
  if (/associate/.test(d)) return "Associate";
  if (/diploma/.test(d)) return "Diploma";
  if (/highschool|secondary|12th|hsc/.test(d)) return "High School";
  return "";
}

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2021-05" or "2021" → "May 2021" / "2021", for reviews and lists.
function showMonth(ym) {
  if (!ym) return "";
  const [y, m] = String(ym).split("-");
  return m ? `${MONTHS[+m - 1].slice(0, 3)} ${y}` : y;
}
function showSpan(entry) {
  const end = entry.current ? "present" : showMonth(entry.end);
  return [showMonth(entry.start), end].filter(Boolean).join(" – ");
}
