/*
 * sprouts.js
 *
 * Sprouts retailer adapter.
 *
 * Retrieval order:
 *
 * 1. Load bundled sprouts-evidence.json
 * 2. Find evidence matching the requested canonical product
 * 3. Normalize + validate + price package requirements
 * 4. If no acceptable evidence remains, attempt dynamic fallback
 *
 * Dynamic fallback currently has no permitted live provider
 * configured. That is intentional.
 */

const fs = require("fs");
const path = require("path");

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");

const {
  searchSproutsDynamic,
  buildSproutsDynamicStatus
} = require("./sprouts-dynamic");


/*
 * =====================================================
 * MARKET
 * =====================================================
 */

const SPROUTS_MARKET = {
  retailer: "Sprouts",
  city: "Knoxville",
  state: "TN",
  zip: "37922",
  address: "9622 Kingston Pike",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * FRESHNESS
 * =====================================================
 */

const CURRENT_MAX_DAYS = 7;
const AGING_MAX_DAYS = 14;


function parseObservedDate(value) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}


function calculateAgeDays(value) {
  const observed =
    parseObservedDate(value);

  if (!observed) {
    return null;
  }

  const now =
    new Date();

  const ageMs =
    now.getTime() -
    observed.getTime();

  if (
    !Number.isFinite(ageMs)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(
      ageMs /
      86400000
    )
  );
}


function getFreshnessStatus(
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
      freshness: "unknown",
      ageDays: null,
      needsRefresh: true
    };
  }

  if (
    ageDays <=
    CURRENT_MAX_DAYS
  ) {
    return {
      freshness: "current",
      ageDays,
      needsRefresh: false
    };
  }

  if (
    ageDays <=
    AGING_MAX_DAYS
  ) {
    return {
      freshness: "aging",
      ageDays,
      needsRefresh: true
    };
  }

  return {
    freshness: "stale",
    ageDays,
    needsRefresh: true
  };
}


/*
 * =====================================================
 * CONFIDENCE
 * =====================================================
 */

function scoreConfidence(
  evidence
) {
  let score = 0;

  if (
    evidence.retailer ===
    "Sprouts"
  ) {
    score += 20;
  }

  if (
    Number(
      evidence.price
    ) > 0
  ) {
    score += 20;
  }

  if (
    evidence.size
  ) {
    score += 15;
  }

  if (
    evidence.locationConfirmed ===
    true
  ) {
    score += 20;

  } else if (
    evidence.marketConfirmed ===
    true
  ) {
    score += 10;
  }

  const freshness =
    getFreshnessStatus(
      evidence.observedAt
    );

  if (
    freshness.freshness ===
    "current"
  ) {
    score += 15;

  } else if (
    freshness.freshness ===
    "aging"
  ) {
    score += 8;

  } else if (
    freshness.freshness ===
    "stale"
  ) {
    score += 2;
  }

  const trustedSources = [
    "retailer-product-page",
    "retailer-weekly-ad",
    "retailer-digital-ad",
    "public-product-record",
    "public-indexed-product-page"
  ];

  if (
    trustedSources.includes(
      evidence.sourceType
    )
  ) {
    score += 10;
  }

  if (
    evidence.sourceUrl
  ) {
    score += 5;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}


/*
 * =====================================================
 * LOAD SPROUTS EVIDENCE
 * =====================================================
 */

function loadSproutsEvidence() {
  const candidates = [
    path.join(
      process.cwd(),
      "data",
      "sprouts-evidence.json"
    ),

    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "data",
      "sprouts-evidence.json"
    )
  ];

  for (
    const filePath of
    candidates
  ) {
    try {
      if (
        !fs.existsSync(
          filePath
        )
      ) {
        continue;
      }

      const parsed =
        JSON.parse(
          fs.readFileSync(
            filePath,
            "utf8"
          )
        );

      if (
        Array.isArray(
          parsed
        )
      ) {
        return parsed;
      }

    } catch (
      error
    ) {
      /*
       * Try next path.
       */
    }
  }

  return [];
}


/*
 * =====================================================
 * ATTRIBUTE SAFETY
 *
 * Do not allow a non-organic record to satisfy an
 * explicitly organic request, etc.
 * =====================================================
 */

function passesAttributeConstraints(
  request,
  normalized
) {
  const required =
    request?.attributes ||
    {};

  const offered =
    normalized?.attributes ||
    {};

  if (
    required.organic &&
    !offered.organic
  ) {
    return false;
  }

  if (
    required.grassFed &&
    !offered.grassFed
  ) {
    return false;
  }

  if (
    required.lean8515 &&
    !offered.lean8515
  ) {
    return false;
  }

  if (
    required.wholeBean &&
    !offered.wholeBean
  ) {
    return false;
  }

  if (
    required.frozen &&
    !offered.frozen
  ) {
    return false;
  }

  if (
    required.fresh &&
    offered.frozen
  ) {
    return false;
  }

  return true;
}


/*
 * =====================================================
 * CANONICAL FILTER
 *
 * This is the key behavior for custom products.
 *
 * custom-organic-japanese-yams
 *
 * must be allowed to retrieve the evidence record with
 * that exact canonicalId.
 * =====================================================
 */

function filterSproutsEvidence(
  request,
  records
) {
  const safeRecords =
    Array.isArray(records)
      ? records
      : [];

  const canonicalId =
    request?.canonicalId ||
    null;

  if (!canonicalId) {
    return safeRecords;
  }

  return safeRecords.filter(
    record =>
      record?.canonicalId ===
      canonicalId
  );
}


/*
 * =====================================================
 * RETRIEVE RAW CANDIDATES
 * =====================================================
 */

function retrieveSproutsCandidates(
  request,
  suppliedEvidence = null
) {
  const allEvidence =
    Array.isArray(
      suppliedEvidence
    )
      ? suppliedEvidence
      : loadSproutsEvidence();

  return filterSproutsEvidence(
    request,
    allEvidence
  );
}


/*
 * =====================================================
 * NORMALIZE ONE EVIDENCE RECORD
 * =====================================================
 */

function normalizeSproutsEvidence(
  evidence
) {
  if (!evidence) {
    return null;
  }

  const normalized =
    normalizeOffer({
      retailer:
        "Sprouts",

      title:
        evidence.title ||
        evidence.product ||
        "",

      brand:
        evidence.brand ||
        null,

      description:
        evidence.description ||
        evidence.title ||
        "",

      size:
        evidence.size ||
        "",

      price:
        evidence.price,

      productId:
        evidence.productId ||
        evidence.upc ||
        null,

      attributes:
        evidence.attributes ||
        null,

      location: {
        retailer:
          "Sprouts",

        city:
          SPROUTS_MARKET.city,

        state:
          SPROUTS_MARKET.state,

        zip:
          SPROUTS_MARKET.zip,

        address:
          SPROUTS_MARKET.address,

        market:
          SPROUTS_MARKET.market,

        confirmed:
          Boolean(
            evidence.locationConfirmed
          ),

        locationConfirmed:
          Boolean(
            evidence.locationConfirmed
          ),

        marketConfirmed:
          Boolean(
            evidence.marketConfirmed
          )
      },

      source: {
        type:
          evidence.sourceType ||
          "public-product-record",

        url:
          evidence.sourceUrl ||
          null,

        observedAt:
          evidence.observedAt ||
          null
      }
    });

  if (!normalized) {
    return null;
  }

  const freshness =
    getFreshnessStatus(
      evidence.observedAt
    );

  normalized.confidenceScore =
    scoreConfidence({
      retailer:
        "Sprouts",

      price:
        evidence.price,

      size:
        evidence.size,

      locationConfirmed:
        evidence.locationConfirmed,

      marketConfirmed:
        evidence.marketConfirmed,

      observedAt:
        evidence.observedAt,

      sourceType:
        evidence.sourceType,

      sourceUrl:
        evidence.sourceUrl
    });

  normalized.canonicalId =
    evidence.canonicalId ||
    null;

  normalized.observedAt =
    evidence.observedAt ||
    null;

  normalized.sourceType =
    evidence.sourceType ||
    "public-product-record";

  normalized.sourceUrl =
    evidence.sourceUrl ||
    null;

  normalized.freshness =
    freshness.freshness;

  normalized.ageDays =
    freshness.ageDays;

  normalized.needsRefresh =
    freshness.needsRefresh;

  return normalized;
}


/*
 * =====================================================
 * BUILD ACCEPTABLE STORED OFFERS
 * =====================================================
 */

function buildSproutsEvidenceOffers(
  request,
  rawCandidates
) {
  const offers = [];

  const candidates =
    Array.isArray(
      rawCandidates
    )
      ? rawCandidates
      : [];

  for (
    const candidate of
    candidates
  ) {
    const normalized =
      normalizeSproutsEvidence(
        candidate
      );

    if (!normalized) {
      continue;
    }

    if (
      !passesAttributeConstraints(
        request,
        normalized
      )
    ) {
      continue;
    }

    const matchScore =
      scoreProductMatch(
        request,
        normalized
      );

    const packagePlan =
      calculatePackageRequirement(
        request,
        normalized
      );

    if (
      !packagePlan
    ) {
      continue;
    }

    if (
      matchScore < 60
    ) {
      continue;
    }

    if (
      normalized
        .confidenceScore <
      55
    ) {
      continue;
    }

    offers.push({
      retailer:
        "Sprouts",

      title:
        normalized.title,

      brand:
        normalized.brand ||
        null,

      productId:
        normalized.productId ||
        null,

      canonicalId:
        candidate.canonicalId ||
        null,

      package:
        normalized.package,

      price:
        normalized.price,

      attributes:
        normalized.attributes,

      location:
        normalized.location,

      source:
        normalized.source,

      sourceType:
        normalized.sourceType,

      sourceUrl:
        normalized.sourceUrl,

      observedAt:
        normalized.observedAt,

      freshness:
        normalized.freshness,

      ageDays:
        normalized.ageDays,

      needsRefresh:
        normalized.needsRefresh,

      matchScore,

      confidenceScore:
        normalized
          .confidenceScore,

      purchasePlan:
        packagePlan,

      totalCost:
        packagePlan.totalCost
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

  return offers;
}


/*
 * =====================================================
 * FRESHNESS SUMMARY
 * =====================================================
 */

function summarizeEvidenceFreshness(
  offers
) {
  const summary = {
    current: 0,
    aging: 0,
    stale: 0,
    unknown: 0,
    needsRefresh: 0
  };

  const safeOffers =
    Array.isArray(offers)
      ? offers
      : [];

  for (
    const offer of
    safeOffers
  ) {
    const freshness =
      offer.freshness ||
      "unknown";

    if (
      Object.prototype
        .hasOwnProperty.call(
          summary,
          freshness
        )
    ) {
      summary[freshness] +=
        1;

    } else {
      summary.unknown +=
        1;
    }

    if (
      offer.needsRefresh ===
      true
    ) {
      summary.needsRefresh +=
        1;
    }
  }

  return summary;
}


/*
 * =====================================================
 * STORED EVIDENCE RESULT
 * =====================================================
 */

function buildStoredEvidenceResult(
  request,
  rawCandidates,
  offers
) {
  return {
    retailer:
      "Sprouts",

    market:
      SPROUTS_MARKET,

    request,

    offers,

    winner:
      offers[0] ||
      null,

    retrieval: {
      source:
        offers.length
          ? "sprouts-evidence-file"
          : "evidence-file-no-match",

      /*
       * recordCount means records matching this requested
       * canonical product, not all records in the file.
       */

      recordCount:
        rawCandidates.length,

      acceptedCount:
        offers.length,

      freshness:
        summarizeEvidenceFreshness(
          offers
        ),

      primarySource:
        "sprouts-evidence-file",

      fallbackAttempted:
        false,

      fallbackSource:
        null,

      fallbackAcceptedCount:
        0,

      dynamicStatus:
        null
    }
  };
}


/*
 * =====================================================
 * DYNAMIC RESULT
 * =====================================================
 */

function buildDynamicResult(
  request,
  dynamicResult
) {
  const offers =
    Array.isArray(
      dynamicResult?.offers
    )
      ? dynamicResult.offers
      : [];

  return {
    retailer:
      "Sprouts",

    market:
      SPROUTS_MARKET,

    request,

    offers,

    winner:
      offers[0] ||
      null,

    retrieval: {
      source:
        offers.length
          ? "sprouts-dynamic-search"
          : "evidence-file-no-match",

      recordCount:
        Number(
          dynamicResult
            ?.retrieval
            ?.recordCount ||
          0
        ),

      acceptedCount:
        offers.length,

      freshness:
        summarizeEvidenceFreshness(
          offers
        ),

      primarySource:
        "sprouts-evidence-file",

      fallbackAttempted:
        true,

      fallbackSource:
        "sprouts-dynamic-search",

      fallbackAcceptedCount:
        offers.length,

      dynamicStatus:
        buildSproutsDynamicStatus(
          dynamicResult
        )
    }
  };
}


/*
 * =====================================================
 * MAIN RETRIEVAL
 * =====================================================
 */

async function getSproutsOffers(
  request,
  suppliedEvidence = null
) {

  /*
   * STEP 1
   *
   * Load the evidence file and retrieve the records
   * matching this exact canonical product.
   */

  const rawCandidates =
    retrieveSproutsCandidates(
      request,
      suppliedEvidence
    );


  /*
   * STEP 2
   *
   * Normalize and validate those records.
   */

  const evidenceOffers =
    buildSproutsEvidenceOffers(
      request,
      rawCandidates
    );


  const evidenceResult =
    buildStoredEvidenceResult(
      request,
      rawCandidates,
      evidenceOffers
    );


  /*
   * STEP 3
   *
   * Stored evidence won.
   */

  if (
    evidenceOffers.length
  ) {
    return evidenceResult;
  }


  /*
   * STEP 4
   *
   * No usable stored evidence.
   * Attempt dynamic fallback.
   */

  let dynamicResult;

  try {
    dynamicResult =
      await searchSproutsDynamic(
        request
      );

  } catch (
    error
  ) {
    return {
      ...evidenceResult,

      retrieval: {
        ...evidenceResult
          .retrieval,

        fallbackAttempted:
          true,

        fallbackSource:
          "sprouts-dynamic-search",

        fallbackAcceptedCount:
          0,

        dynamicStatus: {
          retailer:
            "Sprouts",

          configured:
            false,

          attempted:
            true,

          source:
            "sprouts-dynamic-search",

          acceptedCount:
            0,

          message:
            error.message,

          location:
            SPROUTS_MARKET
        }
      }
    };
  }


  /*
   * STEP 5
   *
   * Normalize dynamic response.
   */

  const dynamicNormalized =
    buildDynamicResult(
      request,
      dynamicResult
    );


  /*
   * STEP 6
   *
   * If future dynamic search produces acceptable
   * offers, return them.
   */

  if (
    dynamicNormalized
      .offers
      .length
  ) {
    return dynamicNormalized;
  }


  /*
   * STEP 7
   *
   * Nothing found.
   *
   * Return the evidence result and expose the fact
   * that fallback was attempted but unavailable.
   */

  return {
    ...evidenceResult,

    retrieval: {
      ...evidenceResult
        .retrieval,

      fallbackAttempted:
        true,

      fallbackSource:
        "sprouts-dynamic-search",

      fallbackAcceptedCount:
        0,

      dynamicStatus:
        dynamicNormalized
          .retrieval
          .dynamicStatus
    }
  };
}


/*
 * =====================================================
 * STATUS HELPER
 * =====================================================
 */

function buildSproutsStatus(
  result
) {
  const offers =
    Array.isArray(
      result?.offers
    )
      ? result.offers
      : [];

  const retrieval =
    result?.retrieval ||
    {};

  let newestObservedAt =
    null;

  for (
    const offer of
    offers
  ) {
    const observedAt =
      offer.observedAt ||
      offer.source
        ?.observedAt ||
      null;

    if (!observedAt) {
      continue;
    }

    if (
      !newestObservedAt
    ) {
      newestObservedAt =
        observedAt;

      continue;
    }

    const current =
      parseObservedDate(
        newestObservedAt
      );

    const candidate =
      parseObservedDate(
        observedAt
      );

    if (
      candidate &&
      (
        !current ||
        candidate.getTime() >
          current.getTime()
      )
    ) {
      newestObservedAt =
        observedAt;
    }
  }

  return {
    retailer:
      "Sprouts",

    location:
      SPROUTS_MARKET,

    offerCount:
      offers.length,

    source:
      retrieval.source ||
      null,

    fallbackAttempted:
      Boolean(
        retrieval.fallbackAttempted
      ),

    fallbackSource:
      retrieval.fallbackSource ||
      null,

    fallbackAcceptedCount:
      Number(
        retrieval.fallbackAcceptedCount ||
        0
      ),

    newestObservedAt,

    freshness:
      retrieval.freshness ||
      summarizeEvidenceFreshness(
        offers
      ),

    dynamic:
      retrieval.dynamicStatus ||
      null
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  SPROUTS_MARKET,

  scoreConfidence,

  loadSproutsEvidence,

  filterSproutsEvidence,

  retrieveSproutsCandidates,

  normalizeSproutsEvidence,

  buildSproutsEvidenceOffers,

  getSproutsOffers,

  buildSproutsStatus
};
