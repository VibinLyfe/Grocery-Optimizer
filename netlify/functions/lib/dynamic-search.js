/*
 * dynamic-search.js
 *
 * Shared dynamic-search normalization and validation layer.
 *
 * IMPORTANT:
 * This file does NOT scrape retailer websites and does NOT
 * perform a web search by itself.
 *
 * Its job is to accept dynamic public-search results from a
 * future permitted search source, normalize them into the
 * Grocery Optimizer's common offer format, score confidence,
 * reject weak matches, and return valid retailer offers.
 */

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


const DEFAULT_MIN_MATCH_SCORE = 60;
const DEFAULT_MIN_CONFIDENCE_SCORE = 55;


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function clampScore(value) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Number(value) || 0
      )
    )
  );
}


function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function uniqueStrings(values) {
  return [
    ...new Set(
      (Array.isArray(values)
        ? values
        : []
      )
        .map(value =>
          String(value || "").trim()
        )
        .filter(Boolean)
    )
  ];
}


/*
 * =====================================================
 * DATE / FRESHNESS
 * =====================================================
 */

function parseDate(value) {
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


function calculateAgeDays(
  observedAt,
  now = new Date()
) {
  const observed =
    parseDate(observedAt);

  if (!observed) {
    return null;
  }

  const current =
    now instanceof Date
      ? now
      : new Date(now);

  if (
    Number.isNaN(
      current.getTime()
    )
  ) {
    return null;
  }

  const difference =
    current.getTime() -
    observed.getTime();

  return Math.max(
    0,
    Math.floor(
      difference /
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

  if (ageDays === null) {
    return {
      ageDays: null,
      freshness: "unknown",
      needsRefresh: true
    };
  }

  if (ageDays <= 7) {
    return {
      ageDays,
      freshness: "current",
      needsRefresh: false
    };
  }

  if (ageDays <= 14) {
    return {
      ageDays,
      freshness: "aging",
      needsRefresh: true
    };
  }

  return {
    ageDays,
    freshness: "stale",
    needsRefresh: true
  };
}


/*
 * =====================================================
 * SEARCH RESULT SHAPE
 *
 * Expected raw result:
 *
 * {
 *   retailer: "Earth Fare",
 *   title: "Organic Japanese Sweet Potato",
 *   brand: null,
 *   description: "...",
 *   size: "1 lb",
 *   price: 4.49,
 *   productId: "...",
 *   sourceUrl: "...",
 *   sourceType: "public-search-result",
 *   observedAt: "2026-08-29",
 *   marketConfirmed: true,
 *   locationConfirmed: false,
 *   attributes: {...}
 * }
 *
 * =====================================================
 */

function normalizeSearchRecord(
  record,
  config
) {
  if (!record) {
    return null;
  }

  const retailer =
    record.retailer ||
    config.retailer;

  if (
    cleanText(retailer) !==
    cleanText(
      config.retailer
    )
  ) {
    return null;
  }

  const price =
    safeNumber(
      record.price
    );

  if (
    price === null ||
    price <= 0
  ) {
    return null;
  }

  const title =
    record.title ||
    record.product ||
    record.description ||
    "";

  const size =
    record.size ||
    record.packageSize ||
    "";

  const normalized =
    normalizeOffer({
      retailer:
        config.retailer,

      title,

      brand:
        record.brand ||
        null,

      description:
        [
          record.description,
          title,
          size
        ]
          .filter(Boolean)
          .join(" "),

      size,

      price,

      productId:
        record.productId ||
        record.upc ||
        null,

      attributes:
        record.attributes ||
        null,

      location: {
        market:
          config.market ||
          null,

        address:
          config.address ||
          null,

        zip:
          config.zip ||
          null,

        confirmed:
          Boolean(
            record.locationConfirmed
          )
      },

      source: {
        type:
          record.sourceType ||
          "public-search-result",

        url:
          record.sourceUrl ||
          null,

        observedAt:
          record.observedAt ||
          null,

        marketConfirmed:
          Boolean(
            record.marketConfirmed
          ),

        locationConfirmed:
          Boolean(
            record.locationConfirmed
          )
      }
    });

  if (!normalized) {
    return null;
  }

  const freshness =
    getFreshness(
      record.observedAt
    );

  return {
    ...normalized,

    rawSearchRecord:
      record,

    sourceUrl:
      record.sourceUrl ||
      null,

    sourceType:
      record.sourceType ||
      "public-search-result",

    observedAt:
      record.observedAt ||
      null,

    marketConfirmed:
      Boolean(
        record.marketConfirmed
      ),

    locationConfirmed:
      Boolean(
        record.locationConfirmed
      ),

    ageDays:
      freshness.ageDays,

    freshness:
      freshness.freshness,

    needsRefresh:
      freshness.needsRefresh
  };
}


/*
 * =====================================================
 * CONFIDENCE SCORING
 * =====================================================
 */

function scoreDynamicConfidence(
  record,
  normalized,
  config
) {
  let score = 0;

  if (
    cleanText(
      record.retailer ||
      config.retailer
    ) ===
    cleanText(
      config.retailer
    )
  ) {
    score += 20;
  }

  if (
    safeNumber(
      record.price
    ) > 0
  ) {
    score += 20;
  }

  if (
    record.size ||
    normalized.package
  ) {
    score += 15;
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
    normalized.freshness ===
    "current"
  ) {
    score += 15;

  } else if (
    normalized.freshness ===
    "aging"
  ) {
    score += 8;

  } else if (
    normalized.freshness ===
    "stale"
  ) {
    score += 2;
  }

  const trustedSourceTypes =
    Array.isArray(
      config.trustedSourceTypes
    )
      ? config.trustedSourceTypes
      : [
          "retailer-product-page",
          "retailer-search-result",
          "public-product-record",
          "public-search-result"
        ];

  if (
    trustedSourceTypes.includes(
      normalized.sourceType
    )
  ) {
    score += 10;
  }

  if (
    normalized.sourceUrl
  ) {
    score += 5;
  }

  return clampScore(score);
}


/*
 * =====================================================
 * ATTRIBUTE SAFETY
 *
 * These checks intentionally make dynamic search
 * conservative. Required attributes should never be
 * silently discarded.
 * =====================================================
 */

function hasRequiredAttribute(
  request,
  offer,
  attribute
) {
  if (
    !request?.attributes?.[
      attribute
    ]
  ) {
    return true;
  }

  return Boolean(
    offer?.attributes?.[
      attribute
    ]
  );
}


function passesAttributeConstraints(
  request,
  offer
) {
  const required = [
    "organic",
    "grassFed",
    "frozen",
    "fresh",
    "wholeBean",
    "ground",
    "lean8515"
  ];

  for (
    const attribute of
    required
  ) {
    if (
      !hasRequiredAttribute(
        request,
        offer,
        attribute
      )
    ) {
      return false;
    }
  }

  return true;
}


/*
 * =====================================================
 * DYNAMIC RESULT VALIDATION
 * =====================================================
 */

function validateDynamicResult({
  request,
  record,
  config
}) {
  const normalized =
    normalizeSearchRecord(
      record,
      config
    );

  if (!normalized) {
    return {
      accepted: false,
      reason:
        "normalization-failed"
    };
  }

  const matchScore =
    scoreProductMatch(
      request,
      normalized
    );

  const confidenceScore =
    scoreDynamicConfidence(
      record,
      normalized,
      config
    );

  const minimumMatchScore =
    Number.isFinite(
      Number(
        config.minimumMatchScore
      )
    )
      ? Number(
          config.minimumMatchScore
        )
      : DEFAULT_MIN_MATCH_SCORE;

  const minimumConfidenceScore =
    Number.isFinite(
      Number(
        config.minimumConfidenceScore
      )
    )
      ? Number(
          config.minimumConfidenceScore
        )
      : DEFAULT_MIN_CONFIDENCE_SCORE;

  if (
    !passesAttributeConstraints(
      request,
      normalized
    )
  ) {
    return {
      accepted: false,
      reason:
        "required-attribute-mismatch",
      matchScore,
      confidenceScore
    };
  }

  if (
    matchScore <
    minimumMatchScore
  ) {
    return {
      accepted: false,
      reason:
        "match-score-too-low",
      matchScore,
      confidenceScore
    };
  }

  if (
    confidenceScore <
    minimumConfidenceScore
  ) {
    return {
      accepted: false,
      reason:
        "confidence-too-low",
      matchScore,
      confidenceScore
    };
  }

  const purchasePlan =
    calculatePackageRequirement(
      request,
      normalized
    );

  if (!purchasePlan) {
    return {
      accepted: false,
      reason:
        "incompatible-package-unit",
      matchScore,
      confidenceScore
    };
  }

  return {
    accepted: true,

    offer: {
      retailer:
        config.retailer,

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
        normalized.location,

      source:
        normalized.source,

      sourceType:
        normalized.sourceType,

      sourceUrl:
        normalized.sourceUrl,

      observedAt:
        normalized.observedAt,

      ageDays:
        normalized.ageDays,

      freshness:
        normalized.freshness,

      needsRefresh:
        normalized.needsRefresh,

      matchScore,

      confidenceScore,

      purchasePlan,

      totalCost:
        purchasePlan.totalCost
    }
  };
}


/*
 * =====================================================
 * PROCESS SEARCH RESULTS
 * =====================================================
 */

function processDynamicResults({
  request,
  records,
  config
}) {
  const safeRecords =
    Array.isArray(records)
      ? records
      : [];

  const accepted = [];
  const rejected = [];

  for (
    const record of
    safeRecords
  ) {
    const result =
      validateDynamicResult({
        request,
        record,
        config
      });

    if (
      result.accepted
    ) {
      accepted.push(
        result.offer
      );

    } else {
      rejected.push({
        title:
          record?.title ||
          record?.product ||
          null,

        sourceUrl:
          record?.sourceUrl ||
          null,

        reason:
          result.reason,

        matchScore:
          result.matchScore ??
          null,

        confidenceScore:
          result.confidenceScore ??
          null
      });
    }
  }

  accepted.sort(
    (a, b) =>
      a.totalCost -
        b.totalCost ||

      b.matchScore -
        a.matchScore ||

      b.confidenceScore -
        a.confidenceScore
  );

  return {
    accepted,
    rejected,

    winner:
      accepted[0] ||
      null
  };
}


/*
 * =====================================================
 * QUERY BUILDING
 *
 * This creates search phrases for a future permitted
 * public-search provider.
 * =====================================================
 */

function buildSearchQueries({
  request,
  retailer,
  city,
  state
}) {
  const description =
    String(
      request?.description ||
      ""
    )
      .replace(
        /^\s*\d+(?:\.\d+)?\s+\S+\s+/,
        ""
      )
      .trim();

  const canonicalId =
    String(
      request?.canonicalId ||
      ""
    ).trim();

  const location =
    [
      city,
      state
    ]
      .filter(Boolean)
      .join(" ");

  const queries = [
    [
      retailer,
      description,
      location,
      "price"
    ]
      .filter(Boolean)
      .join(" "),

    [
      retailer,
      canonicalId,
      location
    ]
      .filter(Boolean)
      .join(" "),

    [
      `"${description}"`,
      retailer
    ]
      .filter(Boolean)
      .join(" ")
  ];

  return uniqueStrings(
    queries
  );
}


/*
 * =====================================================
 * ADAPTER FACTORY
 *
 * searchProvider is intentionally injected.
 *
 * The provider must eventually implement:
 *
 * async function searchProvider({
 *   retailer,
 *   request,
 *   queries,
 *   config
 * }) {
 *   return {
 *     source: "some-provider-name",
 *     records: [...]
 *   };
 * }
 *
 * =====================================================
 */

function createDynamicSearchAdapter(
  config
) {
  if (
    !config ||
    !config.retailer
  ) {
    throw new Error(
      "Dynamic search configuration requires a retailer name."
    );
  }

  async function search(
    request
  ) {
    const queries =
      buildSearchQueries({
        request,
        retailer:
          config.retailer,
        city:
          config.city,
        state:
          config.state
      });

    if (
      typeof config.searchProvider !==
      "function"
    ) {
      return {
        retailer:
          config.retailer,

        request,

        retrieval: {
          attempted: false,
          source: null,
          queries,
          recordCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          message:
            "Dynamic search adapter is ready, but no permitted search provider is configured."
        },

        offers: [],
        winner: null
      };
    }

    let providerResult;

    try {
      providerResult =
        await config.searchProvider({
          retailer:
            config.retailer,

          request,

          queries,

          config
        });

    } catch (error) {
      return {
        retailer:
          config.retailer,

        request,

        retrieval: {
          attempted: true,
          source: null,
          queries,
          recordCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          message:
            error.message
        },

        offers: [],
        winner: null
      };
    }

    const records =
      Array.isArray(
        providerResult?.records
      )
        ? providerResult.records
        : [];

    const processed =
      processDynamicResults({
        request,
        records,
        config
      });

    return {
      retailer:
        config.retailer,

      request,

      retrieval: {
        attempted: true,

        source:
          providerResult?.source ||
          "dynamic-public-search",

        queries,

        recordCount:
          records.length,

        acceptedCount:
          processed.accepted.length,

        rejectedCount:
          processed.rejected.length,

        rejected:
          processed.rejected
      },

      offers:
        processed.accepted,

      winner:
        processed.winner
    };
  }

  return {
    config,
    search
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  DEFAULT_MIN_MATCH_SCORE,
  DEFAULT_MIN_CONFIDENCE_SCORE,

  cleanText,
  calculateAgeDays,
  getFreshness,

  normalizeSearchRecord,
  scoreDynamicConfidence,
  passesAttributeConstraints,
  validateDynamicResult,
  processDynamicResults,

  buildSearchQueries,

  createDynamicSearchAdapter
};
