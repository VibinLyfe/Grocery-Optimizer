/*
 * Toomey Grocery Optimized
 * netlify/functions/compare.js
 *
 * Main grocery comparison endpoint.
 *
 * Retrieval:
 * - Kroger: live official API
 * - Sprouts: dated public retailer evidence
 * - ALDI: dated public retailer evidence
 * - Earth Fare: dated public retailer evidence
 *
 * Custom products are supported generically.
 *
 * IMPORTANT:
 * Custom canonical IDs now normalize simple singular/plural
 * differences so "yam" and "yams" resolve to the same identity.
 */

const fs = require("fs");
const path = require("path");

const {
  normalizeRequest,
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement,
  detectAttributes,
  normalizeUnit,
  cleanText
} = require("./lib/normalize");


/*
 * =====================================================
 * OPTIONAL RETAILER ADAPTERS
 * =====================================================
 *
 * These are loaded safely so the compare endpoint still
 * works if one retailer adapter has a temporary problem.
 */

let sproutsModule = {};
let aldiModule = {};
let earthFareModule = {};

try {
  sproutsModule =
    require("./lib/sprouts");
} catch (error) {
  console.error(
    "Sprouts module load error:",
    error.message
  );
}

try {
  aldiModule =
    require("./lib/aldi");
} catch (error) {
  console.error(
    "ALDI module load error:",
    error.message
  );
}

try {
  earthFareModule =
    require("./lib/earthfare");
} catch (error) {
  console.error(
    "Earth Fare module load error:",
    error.message
  );
}


/*
 * =====================================================
 * CONSTANTS
 * =====================================================
 */

const KROGER_BASE =
  "https://api.kroger.com/v1";

const KROGER_LOCATION_ID =
  "02600684";

const MARKET =
  "Knoxville, TN";


const RETAILER_LOCATIONS = {
  Kroger: {
    retailer: "Kroger",
    city: "Knoxville",
    state: "TN",
    zip: "37922",
    address: "9225 Kingston Pike",
    market: MARKET
  },

  Sprouts: {
    retailer: "Sprouts",
    city: "Knoxville",
    state: "TN",
    zip: "37922",
    address: "9622 Kingston Pike",
    market: MARKET
  },

  ALDI: {
    retailer: "ALDI",
    city: "Knoxville",
    state: "TN",
    zip: "37922",
    address: "110 Moss Grove Blvd",
    market: MARKET
  },

  "Earth Fare": {
    retailer: "Earth Fare",
    city: "Knoxville",
    state: "TN",
    zip: "37934",
    address: "10903 Parkside Dr",
    market: MARKET
  }
};


const EVIDENCE_FILES = {
  Sprouts:
    "sprouts-evidence.json",

  ALDI:
    "aldi-evidence.json",

  "Earth Fare":
    "earthfare-evidence.json"
};


let tokenCache = {
  token: null,
  expiresAt: 0
};


/*
 * =====================================================
 * RESPONSE
 * =====================================================
 */

function json(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*"
    },

    body:
      JSON.stringify(body)
  };
}


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function safeNumber(
  value
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function round(
  value,
  decimals = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      number *
      factor
    ) /
    factor
  );
}


function titleCase(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


function slugify(
  value
) {
  return cleanText(
    value
  )
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}


/*
 * =====================================================
 * CUSTOM PRODUCT PLURAL NORMALIZATION
 *
 * We intentionally keep this conservative.
 *
 * Examples:
 *
 * yam   -> yams
 * yams  -> yams
 *
 * apple -> apples
 * apples -> apples
 *
 * berry -> berries
 *
 * potato -> potatoes
 *
 * Mass-food words like rice, milk and broccoli are left
 * alone.
 * =====================================================
 */

const MASS_OR_UNCHANGED_WORDS =
  new Set([
    "beef",
    "bread",
    "broccoli",
    "cheese",
    "coffee",
    "fish",
    "milk",
    "oats",
    "oil",
    "quinoa",
    "rice",
    "soap",
    "spinach",
    "turkey",
    "water"
  ]);


const IRREGULAR_PLURALS = {
  potato:
    "potatoes",

  tomato:
    "tomatoes",

  berry:
    "berries",

  cherry:
    "cherries",

  strawberry:
    "strawberries",

  blueberry:
    "blueberries",

  raspberry:
    "raspberries",

  cranberry:
    "cranberries"
};


function pluralizeWord(
  word
) {
  const value =
    cleanText(word);

  if (!value) {
    return value;
  }

  if (
    MASS_OR_UNCHANGED_WORDS
      .has(value)
  ) {
    return value;
  }

  if (
    IRREGULAR_PLURALS[
      value
    ]
  ) {
    return (
      IRREGULAR_PLURALS[
        value
      ]
    );
  }

  /*
   * Already looks plural.
   */

  if (
    value.endsWith(
      "ies"
    ) ||
    value.endsWith(
      "oes"
    )
  ) {
    return value;
  }

  if (
    value.endsWith("s") &&
    !value.endsWith("ss")
  ) {
    return value;
  }

  /*
   * consonant + y
   */

  if (
    /[^aeiou]y$/.test(
      value
    )
  ) {
    return (
      value.slice(
        0,
        -1
      ) +
      "ies"
    );
  }

  /*
   * s / x / z / ch / sh
   */

  if (
    /(s|x|z|ch|sh)$/.test(
      value
    )
  ) {
    return (
      value +
      "es"
    );
  }

  return (
    value +
    "s"
  );
}


function normalizeCustomProductName(
  productName
) {
  const words =
    cleanText(
      productName
    )
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return "";
  }

  const lastIndex =
    words.length - 1;

  words[lastIndex] =
    pluralizeWord(
      words[lastIndex]
    );

  return words.join(" ");
}


function buildCustomCanonical(
  productName
) {
  const normalized =
    normalizeCustomProductName(
      productName
    );

  return (
    `custom-${slugify(
      normalized
    )}`
  );
}


/*
 * =====================================================
 * UNITS
 * =====================================================
 */

const UNIT_PATTERN =
  [
    "fl\\.?\\s*oz\\.?",
    "fluid ounces?",
    "gallons?",
    "gal",
    "quarts?",
    "qt",
    "pints?",
    "pt",
    "kilograms?",
    "kg",
    "grams?",
    "g",
    "pounds?",
    "lbs?",
    "lb",
    "ounces?",
    "oz",
    "dozen",
    "packages?",
    "packs?",
    "each",
    "count",
    "ct",
    "cans?",
    "jars?",
    "bottles?",
    "loaves?",
    "loaf",
    "bags?",
    "rolls?"
  ]
    .join("|");


function normalizeRequestedUnit(
  unit
) {
  const cleaned =
    cleanText(unit);

  /*
   * These are purchasable count units.
   *
   * We treat them as count, not weight.
   */

  if (
    [
      "package",
      "packages",
      "pack",
      "packs",
      "can",
      "cans",
      "jar",
      "jars",
      "bottle",
      "bottles",
      "loaf",
      "loaves",
      "bag",
      "bags",
      "roll",
      "rolls",
      "each",
      "count",
      "ct"
    ].includes(
      cleaned
    )
  ) {
    return {
      quantityMultiplier:
        1,

      normalizedUnit:
        "each",

      displayUnit:
        cleaned
    };
  }

  if (
    cleaned ===
    "dozen"
  ) {
    return {
      quantityMultiplier:
        12,

      normalizedUnit:
        "each",

      displayUnit:
        "dozen"
    };
  }

  return {
    quantityMultiplier:
      1,

    normalizedUnit:
      normalizeUnit(
        cleaned
      ),

    displayUnit:
      cleaned
  };
}


/*
 * =====================================================
 * KNOWN PRODUCTS
 *
 * Keep established canonical IDs stable.
 * =====================================================
 */

function detectKnownProduct(
  productText
) {
  const lower =
    cleanText(
      productText
    );


  if (
    lower.includes(
      "ground beef"
    ) &&
    lower.includes(
      "organic"
    ) &&
    lower.includes(
      "grass"
    ) &&
    (
      lower.includes(
        "85/15"
      ) ||
      lower.includes(
        "85 15"
      ) ||
      lower.includes(
        "85%"
      )
    )
  ) {
    return {
      canonical:
        "ground-beef-organic-grassfed-85-15",

      queryName:
        "organic grass-fed 85/15 ground beef",

      krogerTerm:
        "organic grass fed 85/15 ground beef",

      product:
        "Organic Grass-Fed 85/15 Ground Beef"
    };
  }


  if (
    lower.includes(
      "broccoli"
    ) &&
    lower.includes(
      "organic"
    )
  ) {
    return {
      canonical:
        "organic-broccoli",

      queryName:
        "organic broccoli",

      krogerTerm:
        "organic broccoli",

      product:
        "Organic Broccoli"
    };
  }


  if (
    lower.includes(
      "cucumber"
    ) &&
    lower.includes(
      "organic"
    )
  ) {
    return {
      canonical:
        "organic-cucumber",

      queryName:
        "organic cucumber",

      krogerTerm:
        "organic cucumber",

      product:
        "Organic Cucumber"
    };
  }


  if (
    lower.includes(
      "baby carrot"
    ) &&
    lower.includes(
      "organic"
    )
  ) {
    return {
      canonical:
        "organic-baby-carrots",

      queryName:
        "organic baby carrots",

      krogerTerm:
        "organic baby carrots",

      product:
        "Organic Baby Carrots"
    };
  }


  if (
    lower.includes(
      "mango"
    )
  ) {
    return {
      canonical:
        "mango",

      queryName:
        lower.includes(
          "organic"
        )
          ? "organic mango"
          : "mango",

      krogerTerm:
        lower.includes(
          "organic"
        )
          ? "organic mango"
          : "mango",

      product:
        lower.includes(
          "organic"
        )
          ? "Organic Mango"
          : "Mango"
    };
  }


  return null;
}


/*
 * =====================================================
 * REQUEST PARSING
 * =====================================================
 */

function parseRequest(
  text
) {
  const raw =
    String(
      text || ""
    ).trim();

  const lower =
    cleanText(raw);


  let qty = 1;

  let originalUnit =
    "each";


  /*
   * Read leading:
   *
   * 2 lb
   * 4 each
   * 1 package
   * 12 oz
   */

  const quantityUnitRegex =
    new RegExp(
      `^\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`,
      "i"
    );

  const quantityUnitMatch =
    raw.match(
      quantityUnitRegex
    );


  let productText =
    raw;


  if (
    quantityUnitMatch
  ) {
    qty =
      Number(
        quantityUnitMatch[1]
      );

    originalUnit =
      quantityUnitMatch[2];

    productText =
      raw
        .slice(
          quantityUnitMatch[0]
            .length
        )
        .trim();

  } else {
    const leadingNumber =
      raw.match(
        /^\s*(\d+(?:\.\d+)?)\b/
      );

    if (
      leadingNumber
    ) {
      qty =
        Number(
          leadingNumber[1]
        );

      productText =
        raw
          .slice(
            leadingNumber[0]
              .length
          )
          .trim();
    }
  }


  const unitInfo =
    normalizeRequestedUnit(
      originalUnit
    );


  const normalizedQuantity =
    qty *
    unitInfo.quantityMultiplier;


  const known =
    detectKnownProduct(
      productText
    );


  let canonical;

  let queryName;

  let krogerTerm;

  let product;

  let knownCanonical =
    false;


  if (known) {
    canonical =
      known.canonical;

    queryName =
      known.queryName;

    krogerTerm =
      known.krogerTerm;

    product =
      known.product;

    knownCanonical =
      true;

  } else {
    const normalizedCustomName =
      normalizeCustomProductName(
        productText
      );

    canonical =
      buildCustomCanonical(
        productText
      );

    queryName =
      cleanText(
        productText
      );

    krogerTerm =
      cleanText(
        productText
      );

    product =
      titleCase(
        normalizedCustomName ||
        productText
      );
  }


  const attributes =
    detectAttributes(
      productText
    );


  const normalized =
    normalizeRequest({
      quantity:
        normalizedQuantity,

      unit:
        unitInfo.normalizedUnit,

      description:
        raw,

      canonicalId:
        canonical,

      attributes
    });


  return {
    raw,

    qty,

    unit:
      cleanText(
        originalUnit
      ),

    canonical,

    knownCanonical,

    queryName,

    krogerTerm,

    attributes,

    normalized,

    product
  };
}


/*
 * =====================================================
 * EVIDENCE FILE LOADING
 * =====================================================
 */

function evidencePaths(
  filename
) {
  return [
    path.join(
      process.cwd(),
      "data",
      filename
    ),

    path.join(
      __dirname,
      "..",
      "..",
      "data",
      filename
    )
  ];
}


function loadEvidenceFile(
  filename
) {
  for (
    const filePath of
    evidencePaths(
      filename
    )
  ) {
    try {
      if (
        !fs.existsSync(
          filePath
        )
      ) {
        continue;
      }

      const data =
        JSON.parse(
          fs.readFileSync(
            filePath,
            "utf8"
          )
        );

      if (
        Array.isArray(
          data
        )
      ) {
        return data;
      }

    } catch (
      error
    ) {
      console.error(
        `Could not load ${filename}:`,
        error.message
      );
    }
  }

  return [];
}


/*
 * =====================================================
 * FRESHNESS
 * =====================================================
 */

function calculateAgeDays(
  observedAt
) {
  if (!observedAt) {
    return null;
  }

  const observed =
    new Date(
      observedAt
    );

  if (
    Number.isNaN(
      observed.getTime()
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        observed.getTime()
      ) /
      86400000
    )
  );
}


function getFreshness(
  observedAt
) {
  const ageDays =
    calculateAgeDays(
      observedAt
    );

  if (
    ageDays === null
  ) {
    return {
      freshness:
        "unknown",

      ageDays:
        null,

      needsRefresh:
        true
    };
  }

  if (
    ageDays <= 7
  ) {
    return {
      freshness:
        "current",

      ageDays,

      needsRefresh:
        false
    };
  }

  if (
    ageDays <= 14
  ) {
    return {
      freshness:
        "aging",

      ageDays,

      needsRefresh:
        true
    };
  }

  return {
    freshness:
      "stale",

    ageDays,

    needsRefresh:
      true
  };
}


/*
 * =====================================================
 * EVIDENCE CONFIDENCE
 * =====================================================
 */

function evidenceConfidence(
  record
) {
  let score = 35;

  if (
    safeNumber(
      record.price
    ) > 0
  ) {
    score += 15;
  }

  if (
    record.size
  ) {
    score += 10;
  }

  if (
    record.locationConfirmed ===
    true
  ) {
    score += 20;

  } else if (
    record.marketConfirmed ===
    true
  ) {
    score += 10;
  }

  if (
    record.sourceUrl
  ) {
    score += 5;
  }

  const trusted =
    [
      "retailer-product-page",
      "retailer-weekly-ad",
      "retailer-digital-ad",
      "public-product-record",
      "public-indexed-product-page"
    ];

  if (
    trusted.includes(
      record.sourceType
    )
  ) {
    score += 5;
  }

  const freshness =
    getFreshness(
      record.observedAt
    );

  if (
    freshness.freshness ===
    "current"
  ) {
    score += 10;

  } else if (
    freshness.freshness ===
    "aging"
  ) {
    score += 5;
  }

  return Math.min(
    100,
    Math.round(
      score
    )
  );
}


/*
 * =====================================================
 * DIRECT EVIDENCE NORMALIZATION
 *
 * This is a safety net in addition to the retailer
 * adapters. It only uses actual stored evidence records.
 * =====================================================
 */

function buildDirectEvidenceOffers(
  retailer,
  request,
  records
) {
  const matching =
    (
      Array.isArray(
        records
      )
        ? records
        : []
    )
      .filter(
        record =>
          record?.canonicalId ===
            request.canonicalId &&
          (
            !record.retailer ||
            record.retailer ===
              retailer
          )
      );


  const offers = [];


  for (
    const record of
    matching
  ) {
    const normalized =
      normalizeOffer({
        retailer,

        title:
          record.title ||
          record.product ||
          "",

        brand:
          record.brand ||
          null,

        description:
          record.description ||
          record.title ||
          "",

        size:
          record.size ||
          "",

        price:
          record.price,

        productId:
          record.productId ||
          record.upc ||
          null,

        attributes:
          record.attributes ||
          null,

        location:
          RETAILER_LOCATIONS[
            retailer
          ],

        source: {
          type:
            record.sourceType ||
            "public-product-record",

          url:
            record.sourceUrl ||
            null,

          observedAt:
            record.observedAt ||
            null
        }
      });


    if (!normalized) {
      continue;
    }


    /*
     * Explicit required attributes must still match.
     */

    const requestedAttributes =
      request.attributes ||
      {};

    const offeredAttributes =
      normalized.attributes ||
      {};


    if (
      requestedAttributes.organic &&
      !offeredAttributes.organic
    ) {
      continue;
    }

    if (
      requestedAttributes.grassFed &&
      !offeredAttributes.grassFed
    ) {
      continue;
    }

    if (
      requestedAttributes.lean8515 &&
      !offeredAttributes.lean8515
    ) {
      continue;
    }

    if (
      requestedAttributes.wholeBean &&
      !offeredAttributes.wholeBean
    ) {
      continue;
    }

    if (
      requestedAttributes.frozen &&
      !offeredAttributes.frozen
    ) {
      continue;
    }

    if (
      requestedAttributes.fresh &&
      offeredAttributes.frozen
    ) {
      continue;
    }


    const matchScore =
      scoreProductMatch(
        request,
        normalized
      );


    const purchasePlan =
      calculatePackageRequirement(
        request,
        normalized
      );


    if (
      !purchasePlan ||
      matchScore < 60
    ) {
      continue;
    }


    const freshness =
      getFreshness(
        record.observedAt
      );


    offers.push({
      retailer,

      title:
        normalized.title,

      brand:
        normalized.brand ||
        null,

      productId:
        normalized.productId ||
        null,

      package:
        normalized.package,

      price:
        normalized.price,

      attributes:
        normalized.attributes,

      location:
        RETAILER_LOCATIONS[
          retailer
        ],

      source:
        normalized.source,

      sourceType:
        record.sourceType ||
        normalized.source?.type ||
        null,

      sourceUrl:
        record.sourceUrl ||
        normalized.source?.url ||
        null,

      observedAt:
        record.observedAt ||
        null,

      freshness:
        freshness.freshness,

      ageDays:
        freshness.ageDays,

      needsRefresh:
        freshness.needsRefresh,

      matchScore,

      confidenceScore:
        evidenceConfidence(
          record
        ),

      purchasePlan,

      totalCost:
        purchasePlan.totalCost
    });
  }


  offers.sort(
    (a, b) =>
      a.totalCost -
        b.totalCost ||
      b.matchScore -
        a.matchScore ||
      b.confidenceScore -
        a.confidenceScore
  );


  return {
    matchingRecordCount:
      matching.length,

    offers
  };
}


/*
 * =====================================================
 * RETAILER ADAPTER CALL
 * =====================================================
 */

async function callRetailerAdapter(
  retailer,
  request,
  records
) {
  let fn = null;


  if (
    retailer ===
    "Sprouts"
  ) {
    fn =
      sproutsModule
        .getSproutsOffers;

  } else if (
    retailer ===
    "ALDI"
  ) {
    fn =
      aldiModule
        .getAldiOffers;

  } else if (
    retailer ===
    "Earth Fare"
  ) {
    fn =
      earthFareModule
        .getEarthFareOffers;
  }


  if (
    typeof fn !==
    "function"
  ) {
    return null;
  }


  try {
    /*
     * Passing records keeps behavior deterministic even
     * when an adapter also has its own loader.
     */

    return await fn(
      request,
      records
    );

  } catch (
    error
  ) {
    console.error(
      `${retailer} adapter error:`,
      error.message
    );

    return null;
  }
}


/*
 * =====================================================
 * NORMALIZE ADAPTER OFFER
 * =====================================================
 */

function normalizeAdapterOffer(
  offer
) {
  if (!offer) {
    return null;
  }


  const observedAt =
    offer.observedAt ||
    offer.source
      ?.observedAt ||
    null;


  const freshness =
    getFreshness(
      observedAt
    );


  const totalCost =
    safeNumber(
      offer.totalCost
    ) ??
    safeNumber(
      offer.purchasePlan
        ?.totalCost
    );


  if (
    totalCost === null ||
    totalCost <= 0
  ) {
    return null;
  }


  return {
    ...offer,

    totalCost,

    observedAt,

    freshness:
      offer.freshness ||
      freshness.freshness,

    ageDays:
      offer.ageDays !==
        undefined &&
      offer.ageDays !==
        null
        ? Number(
            offer.ageDays
          )
        : freshness.ageDays,

    needsRefresh:
      offer.needsRefresh !==
        undefined
        ? Boolean(
            offer.needsRefresh
          )
        : freshness.needsRefresh,

    matchScore:
      safeNumber(
        offer.matchScore
      ) ??
      60,

    confidenceScore:
      safeNumber(
        offer.confidenceScore
      ) ??
      60
  };
}


/*
 * =====================================================
 * RETAILER EVIDENCE RETRIEVAL
 * =====================================================
 */

async function getEvidenceRetailer(
  retailer,
  request
) {
  const filename =
    EVIDENCE_FILES[
      retailer
    ];


  const records =
    loadEvidenceFile(
      filename
    );


  const direct =
    buildDirectEvidenceOffers(
      retailer,
      request,
      records
    );


  const adapterResult =
    await callRetailerAdapter(
      retailer,
      request,
      records
    );


  let adapterOffers =
    (
      Array.isArray(
        adapterResult
          ?.offers
      )
        ? adapterResult.offers
        : []
    )
      .map(
        normalizeAdapterOffer
      )
      .filter(Boolean);


  /*
   * Prefer adapter output where available.
   *
   * Direct evidence is the reliable fallback.
   */

  let offers =
    adapterOffers.length
      ? adapterOffers
      : direct.offers;


  offers =
    offers.sort(
      (a, b) =>
        a.totalCost -
          b.totalCost ||
        b.matchScore -
          a.matchScore
    );


  const retrieval =
    adapterResult
      ?.retrieval ||
    {};


  const recordCount =
    retrieval.recordCount !==
      undefined
      ? Number(
          retrieval.recordCount
        )
      : direct
          .matchingRecordCount;


  const acceptedCount =
    offers.length;


  const newestObservedAt =
    offers
      .map(
        offer =>
          offer.observedAt
      )
      .filter(Boolean)
      .sort()
      .reverse()[0] ||
    null;


  const freshnessSummary = {
    current:
      0,

    aging:
      0,

    stale:
      0,

    unknown:
      0,

    needsRefresh:
      0
  };


  for (
    const offer of
    offers
  ) {
    const status =
      offer.freshness ||
      "unknown";

    if (
      freshnessSummary[
        status
      ] !==
      undefined
    ) {
      freshnessSummary[
        status
      ] += 1;

    } else {
      freshnessSummary
        .unknown += 1;
    }

    if (
      offer.needsRefresh
    ) {
      freshnessSummary
        .needsRefresh += 1;
    }
  }


  return {
    retailer,

    offers,

    winner:
      offers[0] ||
      null,

    connector: {
      live:
        false,

      mode:
        "dated-retailer-evidence",

      retrievalSource:
        offers.length
          ? (
              retrieval.source ||
              `${retailer
                .toLowerCase()
                .replace(
                  /\s+/g,
                  ""
                )}-evidence-file`
            )
          : "evidence-file-no-match",

      message:
        `${retailer} pricing was processed through its dated evidence connector.`,

      observedAt:
        newestObservedAt,

      recordCount,

      acceptedCount,

      freshness:
        retrieval.freshness ||
        freshnessSummary,

      fallbackAttempted:
        Boolean(
          retrieval
            .fallbackAttempted
        ),

      fallbackSource:
        retrieval
          .fallbackSource ||
        null,

      fallbackAcceptedCount:
        Number(
          retrieval
            .fallbackAcceptedCount ||
          0
        ),

      dynamic:
        retrieval
          .dynamicStatus ||
        null,

      location:
        RETAILER_LOCATIONS[
          retailer
        ]
    }
  };
}


/*
 * =====================================================
 * KROGER TOKEN
 * =====================================================
 */

async function getKrogerToken() {
  const now =
    Date.now();


  if (
    tokenCache.token &&
    now <
      tokenCache.expiresAt
  ) {
    return (
      tokenCache.token
    );
  }


  const clientId =
    process.env
      .KROGER_CLIENT_ID;

  const clientSecret =
    process.env
      .KROGER_CLIENT_SECRET;


  if (
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "Kroger environment variables are missing in Netlify."
    );
  }


  const basic =
    Buffer
      .from(
        `${clientId}:${clientSecret}`
      )
      .toString(
        "base64"
      );


  const response =
    await fetch(
      `${KROGER_BASE}/connect/oauth2/token`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Basic ${basic}`,

          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json"
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            scope:
              "product.compact"
          }).toString()
      }
    );


  if (!response.ok) {
    throw new Error(
      `Kroger authentication failed with ${response.status}.`
    );
  }


  const payload =
    await response.json();


  tokenCache = {
    token:
      payload.access_token,

    expiresAt:
      now +
      (
        Number(
          payload.expires_in ||
          1800
        ) -
        60
      ) *
      1000
  };


  return (
    tokenCache.token
  );
}


/*
 * =====================================================
 * KROGER FETCH
 * =====================================================
 */

async function krogerFetch(
  url
) {
  const token =
    await getKrogerToken();


  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json"
        }
      }
    );


  if (!response.ok) {
    throw new Error(
      `Kroger API returned ${response.status}.`
    );
  }


  return (
    response.json()
  );
}


/*
 * =====================================================
 * KROGER PRICE
 * =====================================================
 */

function extractKrogerPrice(
  item
) {
  const price =
    item?.price ||
    {};


  const promo =
    Number(
      price.promo
    );

  const regular =
    Number(
      price.regular
    );


  if (
    Number.isFinite(
      promo
    ) &&
    promo > 0
  ) {
    return {
      amount:
        promo,

      regular:
        Number.isFinite(
          regular
        )
          ? regular
          : null,

      type:
        "promo"
    };
  }


  if (
    Number.isFinite(
      regular
    ) &&
    regular > 0
  ) {
    return {
      amount:
        regular,

      regular,

      type:
        "regular"
    };
  }


  return null;
}


/*
 * =====================================================
 * KROGER SEARCH
 * =====================================================
 */

async function searchKroger(
  parsed
) {
  const params =
    new URLSearchParams({
      "filter.term":
        parsed.krogerTerm,

      "filter.locationId":
        KROGER_LOCATION_ID,

      "filter.limit":
        "30"
    });


  const payload =
    await krogerFetch(
      `${KROGER_BASE}/products?${params.toString()}`
    );


  const products =
    Array.isArray(
      payload.data
    )
      ? payload.data
      : [];


  const candidates =
    [];


  for (
    const product of
    products
  ) {
    const items =
      Array.isArray(
        product.items
      )
        ? product.items
        : [];


    for (
      const item of
      items
    ) {
      const priceInfo =
        extractKrogerPrice(
          item
        );


      if (!priceInfo) {
        continue;
      }


      const normalized =
        normalizeOffer({
          retailer:
            "Kroger",

          title:
            product.description ||
            "Kroger product",

          brand:
            product.brand ||
            null,

          description:
            product.description ||
            "",

          size:
            item.size ||
            "",

          price:
            priceInfo.amount,

          productId:
            product.productId ||
            product.upc ||
            null,

          location:
            RETAILER_LOCATIONS
              .Kroger,

          source: {
            type:
              "kroger-live-api",

            url:
              null,

            observedAt:
              null
          }
        });


      if (!normalized) {
        continue;
      }


      const requested =
        parsed.normalized;


      const requestedAttributes =
        requested.attributes ||
        {};

      const offeredAttributes =
        normalized.attributes ||
        {};


      /*
       * Hard attribute constraints.
       */

      if (
        requestedAttributes.organic &&
        !offeredAttributes.organic
      ) {
        continue;
      }

      if (
        requestedAttributes.grassFed &&
        !offeredAttributes.grassFed
      ) {
        continue;
      }

      if (
        requestedAttributes.lean8515 &&
        !offeredAttributes.lean8515
      ) {
        continue;
      }

      if (
        requestedAttributes.wholeBean &&
        !offeredAttributes.wholeBean
      ) {
        continue;
      }


      const matchScore =
        scoreProductMatch(
          requested,
          normalized
        );


      /*
       * Generic custom products use a stricter match
       * threshold so we do not turn "Japanese yams"
       * into some unrelated root vegetable.
       */

      const minimumScore =
        parsed.knownCanonical
          ? 60
          : 70;


      if (
        matchScore <
        minimumScore
      ) {
        continue;
      }


      const purchasePlan =
        calculatePackageRequirement(
          requested,
          normalized
        );


      if (!purchasePlan) {
        continue;
      }


      candidates.push({
        retailer:
          "Kroger",

        title:
          normalized.title,

        brand:
          normalized.brand ||
          null,

        productId:
          normalized.productId ||
          null,

        package:
          normalized.package,

        price:
          normalized.price,

        attributes:
          normalized.attributes,

        location:
          RETAILER_LOCATIONS
            .Kroger,

        source: {
          type:
            "kroger-live-api",

          observedAt:
            null,

          url:
            null
        },

        regularPrice:
          priceInfo.regular,

        priceType:
          priceInfo.type,

        matchScore,

        confidenceScore:
          100,

        purchasePlan,

        totalCost:
          purchasePlan.totalCost
      });
    }
  }


  candidates.sort(
    (a, b) =>
      a.totalCost -
        b.totalCost ||
      b.matchScore -
        a.matchScore
  );


  return {
    offers:
      candidates,

    winner:
      candidates[0] ||
      null
  };
}


/*
 * =====================================================
 * DISPLAY QUANTITY
 * =====================================================
 */

function suppliedDisplayQuantity(
  normalizedQuantity,
  requestedUnit
) {
  const quantity =
    Number(
      normalizedQuantity
    );


  if (
    !Number.isFinite(
      quantity
    )
  ) {
    return null;
  }


  const unit =
    cleanText(
      requestedUnit
    );


  if (
    [
      "lb",
      "lbs",
      "pound",
      "pounds"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity / 16,
      2
    );
  }


  if (
    [
      "kg",
      "kilogram",
      "kilograms"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity /
      35.2739619,
      2
    );
  }


  if (
    [
      "g",
      "gram",
      "grams"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity /
      0.0352739619,
      2
    );
  }


  if (
    [
      "gallon",
      "gallons",
      "gal"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity / 128,
      2
    );
  }


  if (
    [
      "quart",
      "quarts",
      "qt"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity / 32,
      2
    );
  }


  if (
    [
      "pint",
      "pints",
      "pt"
    ].includes(
      unit
    )
  ) {
    return round(
      quantity / 16,
      2
    );
  }


  if (
    unit ===
    "dozen"
  ) {
    return round(
      quantity / 12,
      2
    );
  }


  return round(
    quantity,
    2
  );
}


/*
 * =====================================================
 * PACKAGE OUTPUT
 * =====================================================
 */

function buildPackageOutput(
  offer
) {
  const packageInfo =
    offer.package ||
    {};

  const source =
    offer.source ||
    {};

  const plan =
    offer.purchasePlan ||
    {};


  const freshness =
    offer.freshness
      ? {
          freshness:
            offer.freshness,

          ageDays:
            offer.ageDays ??
            null,

          needsRefresh:
            Boolean(
              offer.needsRefresh
            )
        }
      : getFreshness(
          offer.observedAt ||
          source.observedAt ||
          null
        );


  return {
    product:
      offer.title ||
      offer.product ||
      null,

    brand:
      offer.brand ||
      null,

    packageQty:
      safeNumber(
        packageInfo.quantity
      ) ??
      safeNumber(
        packageInfo
          .packageQuantity
      ) ??
      1,

    packageUnit:
      packageInfo.unit ||
      packageInfo
        .normalizedUnit ||
      null,

    size:
      packageInfo.size ||
      packageInfo.raw ||
      (
        packageInfo.quantity &&
        packageInfo.unit
          ? `${packageInfo.quantity} ${packageInfo.unit}`
          : null
      ),

    price:
      safeNumber(
        offer.price?.total
      ) ??
      safeNumber(
        offer.price
      ),

    regularPrice:
      offer.regularPrice ||
      null,

    priceType:
      offer.priceType ||
      null,

    sourceType:
      offer.sourceType ||
      source.type ||
      null,

    observedAt:
      offer.observedAt ||
      source.observedAt ||
      null,

    sourceUrl:
      offer.sourceUrl ||
      source.url ||
      null,

    productId:
      offer.productId ||
      null,

    matchScore:
      safeNumber(
        offer.matchScore
      ),

    confidenceScore:
      safeNumber(
        offer.confidenceScore
      ),

    freshness:
      freshness.freshness,

    ageDays:
      freshness.ageDays,

    needsRefresh:
      freshness.needsRefresh,

    packagesNeeded:
      safeNumber(
        plan.packagesNeeded
      ) ??
      1
  };
}


/*
 * =====================================================
 * RETAILER RESULT
 * =====================================================
 */

function buildRetailerResult(
  parsed,
  offer,
  dataMode,
  retrievalSource
) {
  if (!offer) {
    return null;
  }


  const plan =
    offer.purchasePlan ||
    {};


  const packagesNeeded =
    Math.max(
      1,
      Number(
        plan.packagesNeeded ||
        1
      )
    );


  const suppliedNormalized =
    safeNumber(
      plan.suppliedQuantity
    );


  const requestedNormalized =
    safeNumber(
      parsed.normalized
        .normalizedQuantity
    );


  const totalQty =
    suppliedDisplayQuantity(
      suppliedNormalized,
      parsed.unit
    );


  const basePackage =
    buildPackageOutput(
      offer
    );


  const packages =
    Array.from(
      {
        length:
          packagesNeeded
      },
      () => ({
        ...basePackage
      })
    );


  const observedAt =
    offer.observedAt ||
    offer.source
      ?.observedAt ||
    null;


  const freshness =
    dataMode ===
    "live"
      ? {
          freshness:
            null,

          ageDays:
            null,

          needsRefresh:
            false
        }
      : getFreshness(
          observedAt
        );


  return {
    retailer:
      offer.retailer,

    requestedQty:
      parsed.qty,

    requestedUnit:
      parsed.unit,

    totalQty:
      totalQty,

    estimatedCost:
      round(
        offer.totalCost ??
        plan.totalCost,
        2
      ),

    match:
      offer.match ||
      "estimated",

    dataMode,

    matchScore:
      safeNumber(
        offer.matchScore
      ),

    confidenceScore:
      safeNumber(
        offer.confidenceScore
      ) ??
      (
        dataMode ===
        "live"
          ? 100
          : 60
      ),

    confidenceMode:
      dataMode ===
      "live"
        ? "live-official-api"
        : "dated-public-retailer-evidence",

    retrievalSource,

    observedAt,

    freshness:
      dataMode ===
      "live"
        ? null
        : (
            offer.freshness ||
            freshness.freshness
          ),

    ageDays:
      dataMode ===
      "live"
        ? null
        : (
            offer.ageDays ??
            freshness.ageDays
          ),

    needsRefresh:
      dataMode ===
      "live"
        ? false
        : (
            offer.needsRefresh ??
            freshness.needsRefresh
          ),

    location:
      offer.location ||
      RETAILER_LOCATIONS[
        offer.retailer
      ] ||
      null,

    normalized: {
      requestedQty:
        requestedNormalized,

      suppliedQty:
        suppliedNormalized,

      unit:
        parsed.normalized
          .normalizedUnit
    },

    packages
  };
}


/*
 * =====================================================
 * HANDLER
 * =====================================================
 */

exports.handler =
  async function (
    event
  ) {
    try {
      const text =
        event
          .queryStringParameters
          ?.q ||
        "";


      if (
        !String(text)
          .trim()
      ) {
        return json(
          200,
          {
            ok:
              false,

            message:
              "Enter a grocery product to compare."
          }
        );
      }


      const parsed =
        parseRequest(
          text
        );


      const results =
        [];


      /*
       * =================================================
       * KROGER
       * =================================================
       */

      let krogerConnector = {
        live:
          false,

        mode:
          "official-api",

        message:
          "Kroger live connector was not attempted."
      };


      try {
        const kroger =
          await searchKroger(
            parsed
          );


        if (
          kroger.winner
        ) {
          const result =
            buildRetailerResult(
              parsed,
              kroger.winner,
              "live",
              "kroger-live-api"
            );


          if (result) {
            results.push(
              result
            );
          }


          krogerConnector = {
            live:
              true,

            mode:
              "official-api",

            message:
              "Kroger live official API returned a relevant priced product.",

            candidateCount:
              kroger.offers
                .length,

            location:
              RETAILER_LOCATIONS
                .Kroger
          };

        } else {
          krogerConnector = {
            live:
              true,

            mode:
              "official-api",

            message:
              "Kroger API connected, but no sufficiently relevant priced product was returned."
          };
        }

      } catch (
        error
      ) {
        krogerConnector = {
          live:
            false,

          mode:
            "official-api",

          message:
            error.message
        };
      }


      /*
       * =================================================
       * SPROUTS
       * =================================================
       */

      const sprouts =
        await getEvidenceRetailer(
          "Sprouts",
          parsed.normalized
        );


      if (
        sprouts.winner
      ) {
        const result =
          buildRetailerResult(
            parsed,
            sprouts.winner,
            "dated-retailer-evidence",
            sprouts.connector
              .retrievalSource
          );


        if (result) {
          results.push(
            result
          );
        }
      }


      /*
       * =================================================
       * ALDI
       * =================================================
       */

      const aldi =
        await getEvidenceRetailer(
          "ALDI",
          parsed.normalized
        );


      if (
        aldi.winner
      ) {
        const result =
          buildRetailerResult(
            parsed,
            aldi.winner,
            "dated-retailer-evidence",
            aldi.connector
              .retrievalSource
          );


        if (result) {
          results.push(
            result
          );
        }
      }


      /*
       * =================================================
       * EARTH FARE
       * =================================================
       */

      const earthFare =
        await getEvidenceRetailer(
          "Earth Fare",
          parsed.normalized
        );


      if (
        earthFare.winner
      ) {
        const result =
          buildRetailerResult(
            parsed,
            earthFare.winner,
            "dated-retailer-evidence",
            earthFare.connector
              .retrievalSource
          );


        if (result) {
          results.push(
            result
          );
        }
      }


      /*
       * Cheapest valid retailer first.
       */

      results.sort(
        (a, b) =>
          Number(
            a.estimatedCost
          ) -
          Number(
            b.estimatedCost
          )
      );


      return json(
        200,
        {
          ok:
            true,

          parsed: {
            raw:
              parsed.raw,

            qty:
              parsed.qty,

            unit:
              parsed.unit,

            canonical:
              parsed.canonical,

            knownCanonical:
              parsed.knownCanonical,

            queryName:
              parsed.queryName,

            krogerTerm:
              parsed.krogerTerm,

            attributes:
              parsed.attributes,

            normalized:
              parsed.normalized
          },

          product:
            parsed.product,

          customProduct:
            !parsed
              .knownCanonical,

          market:
            MARKET,

          disclaimer:
            "Kroger uses its live official API. Sprouts, ALDI, and Earth Fare use dated public retailer evidence where available. No retailer price is invented when reliable evidence is unavailable.",

          connectors: {
            kroger:
              krogerConnector,

            sprouts:
              sprouts.connector,

            aldi:
              aldi.connector,

            earthFare:
              earthFare.connector
          },

          normalization: {
            enabled:
              true,

            internalWeightUnit:
              "oz",

            internalLiquidUnit:
              "fl_oz",

            internalCountUnit:
              "each",

            displayUnit:
              parsed.unit
          },

          results,

          winner:
            results[0] ||
            null
        }
      );

    } catch (
      error
    ) {
      console.error(
        "Compare function error:",
        error
      );


      return json(
        500,
        {
          ok:
            false,

          error:
            error.message
        }
      );
    }
  };
