// =============================================================================
// The word lists the synthetic cohort is built from.
//
// Every name here is invented. The towns and counties are real West Virginia
// places, because a cohort whose geography is fictional cannot exercise the
// location scorer against a real class region — but no person, employer, phone
// number or address in this file belongs to anyone.
//
// Phone numbers are all (304) 555-01xx, the range reserved for fiction
// (NANP 555-0100..555-0199). Emails use `.invalid` and `.local`, both reserved
// by RFC 2606 and undeliverable by construction, so a misconfigured test run
// cannot mail a stranger.
// =============================================================================

/** Invented given names. */
export const FIRST_NAMES = [
  "Alma", "Bryce", "Corah", "Dalen", "Efren", "Fallon", "Garnet", "Halle",
  "Ilene", "Jarrah", "Kessa", "Loman", "Maribel", "Norwood", "Ottilie",
  "Prewitt", "Quilla", "Rennick", "Sable", "Tavish", "Ulmer", "Verity",
  "Wrenna", "Xavia", "Yolen", "Zephra", "Arlo", "Brannon", "Cressa", "Dovie",
  "Emrys", "Farrow", "Gwenda", "Hollis", "Isla", "Jessup", "Kettle", "Lissette",
  "Marrow", "Nyla", "Ozias", "Petra", "Quenby", "Rowan", "Selby", "Truett",
  "Ursa", "Vantry", "Whitlock", "Yarrow",
];

/** Invented surnames. */
export const LAST_NAMES = [
  "Ashgrove", "Bellweather", "Cardwell", "Denbrook", "Everly", "Fenmore",
  "Galewood", "Hartsell", "Inglewright", "Jarrowby", "Kindler", "Lindsell",
  "Marchbank", "Northway", "Oakhaven", "Pinderly", "Quarry", "Ridgelow",
  "Stonebrook", "Thackery", "Underhill", "Vellacourt", "Westmoor", "Yardley",
  "Ambry", "Brightwell", "Coalfield", "Dunmore", "Elderbush", "Foxglove",
  "Grimsby", "Havenhurst", "Ironwood", "Junewell", "Kellerman", "Lowecroft",
  "Merrowfield", "Nettleship", "Ottersby", "Pemberlow", "Quillon", "Rushmoor",
  "Saltmarsh", "Trueblood", "Ulverton", "Verrell", "Winnowby", "Yarborough",
  "Applewhite", "Bracknell",
];

/** Real West Virginia places, paired town to county. */
export const WV_PLACES = [
  { city: "Beckley", county: "Raleigh", zip: "25801" },
  { city: "Charleston", county: "Kanawha", zip: "25301" },
  { city: "Huntington", county: "Cabell", zip: "25701" },
  { city: "Morgantown", county: "Monongalia", zip: "26501" },
  { city: "Parkersburg", county: "Wood", zip: "26101" },
  { city: "Wheeling", county: "Ohio", zip: "26003" },
  { city: "Martinsburg", county: "Berkeley", zip: "25401" },
  { city: "Fairmont", county: "Marion", zip: "26554" },
  { city: "Clarksburg", county: "Harrison", zip: "26301" },
  { city: "Lewisburg", county: "Greenbrier", zip: "24901" },
  { city: "Oak Hill", county: "Fayette", zip: "25901" },
  { city: "Princeton", county: "Mercer", zip: "24740" },
  { city: "Summersville", county: "Nicholas", zip: "26651" },
  { city: "Ripley", county: "Jackson", zip: "25271" },
  { city: "Buckhannon", county: "Upshur", zip: "26201" },
  { city: "Elkins", county: "Randolph", zip: "26241" },
];

/** Invented business names, one per employer. */
export const EMPLOYER_NAMES = [
  "Ridgeline Metal Works",
  "New River Care Home",
  "Blackwater Logistics",
  "Kanawha Valley Grocers",
  "Coalfield Machine & Tool",
  "Greenbrier Family Dental",
  "Tygart Freight Lines",
  "Appalachian Print & Sign",
  "Cheat River Hospitality",
  "Mountain State Data Services",
  "Elk Fork Building Supply",
  "Seneca Home Health",
];

export const EMPLOYER_SECTORS = [
  "Manufacturing",
  "Health care",
  "Warehousing",
  "Retail grocery",
  "Machining",
  "Dental care",
  "Trucking",
  "Printing",
  "Hospitality",
  "Information services",
  "Building supply",
  "Home health",
];

/**
 * The 14-cluster national framework (src/lib/spokes/national-clusters.ts).
 * Copied as data rather than imported so a `.mjs` fixture generator does not
 * pull the TypeScript module graph in; `synthetic-cohort.test.ts` pins the two
 * lists against each other so a rename cannot drift them apart.
 */
export const CLUSTERS = [
  "Advanced Manufacturing",
  "Agriculture",
  "Arts, Entertainment, & Design",
  "Construction",
  "Digital Technology",
  "Education",
  "Energy & Natural Resources",
  "Financial Services",
  "Healthcare & Human Services",
  "Hospitality, Events, & Tourism",
  "Management & Entrepreneurship",
  "Marketing & Sales",
  "Public Service & Safety",
  "Supply Chain & Transportation",
];

/**
 * The seven clusters this synthetic program actually places into — the pool
 * BOTH students and leads draw from.
 *
 * Drawing students and leads independently from all fourteen was the first
 * cut, and it produced a cohort in which most students had no lead in a
 * cluster they had picked. That is not what a SPOKES site looks like: a
 * program in one county has a handful of local sectors, career discovery
 * happens inside that reality, and the job developer enters leads from the
 * same employers. It also made the fixture useless — with no student having a
 * single "fit" lead, precision@3 had nothing to be precise about.
 *
 * The other seven clusters still appear on employers, so cluster handling is
 * exercised across the whole vocabulary; only the student/lead matching pool
 * is narrowed.
 */
export const PROGRAM_CLUSTERS = [
  "Advanced Manufacturing",
  "Construction",
  "Digital Technology",
  "Healthcare & Human Services",
  "Hospitality, Events, & Tourism",
  "Marketing & Sales",
  "Supply Chain & Transportation",
];

/**
 * Certification ids in the shape `Certification.certType` actually holds —
 * hyphenated slugs that `humanizeCertId` turns into words.
 */
export const CERT_IDS = [
  "ready-to-work",
  "forklift-operator",
  "servsafe-food-handler",
  "osha-10",
  "cpr-first-aid",
  "cna",
  "flagger",
  "nccer-core",
];

/** Résumé skill phrases, deliberately plain. */
export const SKILLS = [
  "customer service",
  "cash handling",
  "inventory",
  "forklift",
  "food prep",
  "scheduling",
  "data entry",
  "phone support",
  "cleaning",
  "shipping and receiving",
  "patient care",
  "hand tools",
  "quality checks",
  "loading",
  "filing",
  "spreadsheets",
];

/** RIASEC codes, three letters each. */
export const HOLLAND_CODES = [
  "RIA", "RIE", "RSE", "REC", "IAS", "ISE", "ASE", "SEC", "SEA", "ECS",
  "CRE", "CSE", "RCE", "IRC",
];

export const JOB_TITLES = [
  "Production Associate",
  "Warehouse Selector",
  "Certified Nursing Assistant",
  "Front Desk Associate",
  "Machine Operator",
  "Delivery Driver Helper",
  "Grocery Stocker",
  "Dental Office Assistant",
  "Print Finisher",
  "Housekeeping Attendant",
  "Data Entry Clerk",
  "Building Supply Cashier",
  "Home Health Aide",
  "Shipping Clerk",
  "Line Cook",
  "Maintenance Helper",
  "Quality Inspector",
  "Customer Care Representative",
  "Forklift Operator",
  "Receiving Associate",
];

export const CONTACT_ROLES = [
  "Hiring Manager",
  "Plant Supervisor",
  "Office Manager",
  "Staffing Coordinator",
  "Operations Lead",
  "Owner",
];

/**
 * A phone number in the reserved fiction range. `index` is taken modulo 100 so
 * a caller cannot walk out of 555-0100..555-0199 by generating too many rows.
 */
export function fictionalPhone(index) {
  return `(304) 555-01${String(index % 100).padStart(2, "0")}`;
}
