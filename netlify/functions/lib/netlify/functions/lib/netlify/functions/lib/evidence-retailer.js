/*
 * evidence-retailer.js
 *
 * Shared evidence-based retailer engine
 * for Grocery Optimizer.
 *
 * PURPOSE
 * -------
 * Sprouts, ALDI and Earth Fare can all use this
 * same engine instead of duplicating:
 *
 * - evidence loading
 * - canonical product filtering
 * - freshness tracking
 * - confidence scoring
 * - normalization
 * - product match scoring
 * - package requirement math
 *
 * Each retailer supplies only its configuration
 * and its own evidence JSON file.
 *
 * FRESHNESS
 * ---------
 * 0-7 days   -> current
 * 8-14 days  -> aging
 * 15+ days   -> stale
 */

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


/*
 * =====================================================
 * FRESHNESS CONSTANTS
 * =====================================================
 */

const CURRENT_MAX_DAYS = 7;
const AGING_MAX_DAYS = 14;


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function cleanText(value) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
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


/*
 * =====================================================
 * DATE HELPERS
 * =====================================================
 */

function parseObservedDate(
  observedAt
) {
  if (
    !observedAt
  ) {
    return null;
  }


  const date =
    new Date(
      observedAt
    );


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
    parseObservedDate(
      observedAt
    );


  if (
    !observed
  ) {
    return null;
  }


  const nowDate =
    now instanceof Date
      ? now
      : new Date(now);


  if (
    Number.isNaN(
      nowDate.getTime()
    )
  ) {
    return null;
  }


  const difference =
    nowDate.getTime() -
    observed.getTime();


  return Math.max(
    0,
    Math.floor(
      difference /
      86400000
    )
  );
}


/*
 * =====================================================
 * FRESHNESS STATUS
 * =====================================================
 */

function getFreshnessStatus(
  observedAt,
  now = new Date()
) {
  const ageDays =
    calculateAgeDays(
      observedAt,
      now
    );


  if (
    ageDays === null
  ) {
    return {
      observedAt:
        observedAt ||
        null,

      ageDays:
        null,

      freshness:
        "unknown",

      needsRefresh:
        true
    };
  }


  if (
    ageDays <=
    CURRENT_MAX_DAYS
  ) {
    return {
      observedAt,

      ageDays,

      freshness:
        "current",

      needsRefresh:
        false
    };
  }


  if (
    ageDays <=
    AGING_MAX_DAYS
  ) {
    return {
      observedAt,

      ageDays,

      freshness:
        "aging",

      needsRefresh:
        true
    };
  }


  return {
    observedAt,

    ageDays,

    freshness:
      "stale",

    needsRefresh:
      true
  };
}


/*
 * =====================================================
 * CONFIDENCE SCORE
 *
 * Confidence is separate from product match.
 *
 * DEFAULT POINTS
 * --------------
 * retailer identified        20
 * valid price                20
 * package size               15
 * exact store confirmed      20
 * market confirmed           10
 * freshness                  20 max
 * strong source type          5
 * =====================================================
 */

function scoreConfidence(
  evidence,
  config
) {
  let score = 0;


  /*
   * Retailer identity
   */

  if (
    cleanText(
      evidence.retailer
    ) ===
    cleanText(
      config.retailer
    )
  ) {
    score += 20;
  }


  /*
   * Valid price
   */

  if (
    Number(
      evidence.price
    ) > 0
  ) {
    score += 20;
  }


  /*
   * Package size
   */

  if (
    evidence.size
  ) {
    score += 15;
  }


  /*
   * Location confidence
   */

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


  /*
   * Freshness
   */

  const freshness =
    getFreshnessStatus(
      evidence.observedAt
    );


  if (
    freshness.freshness ===
    "current"
  ) {
    if (
      freshness.ageDays <= 1
    ) {
      score += 20;

    } else if (
      freshness.ageDays <= 3
    ) {
      score += 15;

    } else {
      score += 10;
    }

  } else if (
    freshness.freshness ===
    "aging"
  ) {
    score += 5;
  }


  /*
   * Source quality
   */

  const strongSourceTypes =
    Array.isArray(
      config.strongSourceTypes
    )
      ? config.strongSourceTypes
      : [
          "retailer-product-page",
          "retailer-weekly-ad",
          "public-product-record"
        ];


  if (
    strongSourceTypes.includes(
      evidence.sourceType
    )
  ) {
    score += 5;
  }


  return clampScore(
    score
  );
}


/*
 * =====================================================
 * FILTER EVIDENCE
 * =====================================================
 */

function filterEvidenceRecords(
  records,
  request,
  config
) {
  const canonicalId =
    String(
      request
        ?.canonicalId ||
      ""
    ).trim();


  return (
    Array.isArray(
      records
    )
      ? records
      : []
  ).filter(
    evidence => {

      if (
        !evidence
      ) {
        return false;
      }


      /*
       * Correct retailer only.
       */

      if (
        cleanText(
          evidence.retailer
        ) !==
        cleanText(
          config.retailer
        )
      ) {
        return false;
      }


      /*
       * Exact canonical product match.
       */

      if (
        canonicalId
      ) {
        return (
          String(
            evidence
              .canonicalId ||
            ""
          ).trim() ===
          canonicalId
        );
      }


      return true;
    }
  );
}


/*
 * =====================================================
 * NORMALIZE ONE EVIDENCE RECORD
 * =====================================================
 */

function normalizeEvidenceRecord(
  evidence,
  config
) {
  if (
    !evidence
  ) {
    return null;
  }


  const normalized =
    normalizeOffer({
      retailer:
        config.retailer,

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
        evidence.product ||
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
            evidence
              .locationConfirmed
          )
      },

      source: {
        type:
          evidence.sourceType ||
          "public-web-evidence",

        url:
          evidence.sourceUrl ||
          null,

        observedAt:
          evidence.observedAt ||
          null,

        marketConfirmed:
          Boolean(
            evidence
              .marketConfirmed
          ),

        locationConfirmed:
          Boolean(
            evidence
              .locationConfirmed
          )
      }
    });


  if (
    !normalized
  ) {
    return null;
  }


  const freshness =
    getFreshnessStatus(
      evidence.observedAt
    );


  normalized.canonicalId =
    evidence.canonicalId ||
    null;


  normalized.rawSize =
    evidence.size ||
    null;


  normalized.observedAt =
    evidence.observedAt ||
    null;


  normalized.sourceType =
    evidence.sourceType ||
    "public-web-evidence";


  normalized.sourceUrl =
    evidence.sourceUrl ||
    null;


  normalized.ageDays =
    freshness.ageDays;


  normalized.freshness =
    freshness.freshness;


  normalized.needsRefresh =
    freshness.needsRefresh;


  normalized.confidenceScore =
    scoreConfidence(
      evidence,
      config
    );


  return normalized;
}


/*
 * =====================================================
 * BUILD OFFERS
 * =====================================================
 */

function buildEvidenceOffers({
  request,
  records,
  config
}) {
  const matchingRecords =
    filterEvidenceRecords(
      records,
      request,
      config
    );


  const offers = [];


  for (
    const evidence of
    matchingRecords
  ) {
    const normalized =
      normalizeEvidenceRecord(
        evidence,
        config
      );


    if (
      !normalized
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


    /*
     * Minimums may be changed per retailer,
     * but these are our shared defaults.
     */

    const minimumMatchScore =
      Number.isFinite(
        Number(
          config.minimumMatchScore
        )
      )
        ? Number(
            config.minimumMatchScore
          )
        : 60;


    const minimumConfidenceScore =
      Number.isFinite(
        Number(
          config.minimumConfidenceScore
        )
      )
        ? Number(
            config.minimumConfidenceScore
          )
        : 30;


    if (
      !packagePlan ||
      matchScore <
        minimumMatchScore ||
      normalized
        .confidenceScore <
        minimumConfidenceScore
    ) {
      continue;
    }


    offers.push({
      retailer:
        config.retailer,

      title:
        normalized.title,

      brand:
        normalized.brand,

      productId:
        normalized.productId,

      canonicalId:
        normalized.canonicalId,

      rawSize:
        normalized.rawSize,

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

      confidenceScore:
        normalized.confidenceScore,

      purchasePlan:
        packagePlan,

      totalCost:
        packagePlan.totalCost
    });
  }


  /*
   * Lowest actual purchase cost first.
   *
   * Tie breakers:
   * 1. fresher evidence
   * 2. stronger product match
   * 3. stronger confidence
   */

  const freshnessRank = {
    current: 0,
    aging: 1,
    stale: 2,
    unknown: 3
  };


  offers.sort(
    (a, b) =>
      a.totalCost -
        b.totalCost ||

      (
        freshnessRank[
          a.freshness
        ] ?? 99
      ) -
      (
        freshnessRank[
          b.freshness
        ] ?? 99
      ) ||

      b.matchScore -
        a.matchScore ||

      b.confidenceScore -
        a.confidenceScore
  );


  return {
    matchingRecords,
    offers
  };
}


/*
 * =====================================================
 * FRESHNESS SUMMARY
 * =====================================================
 */

function summarizeEvidenceFreshness(
  offers
) {
  const safeOffers =
    Array.isArray(
      offers
    )
      ? offers
      : [];


  return {
    current:
      safeOffers.filter(
        offer =>
          offer.freshness ===
          "current"
      ).length,

    aging:
      safeOffers.filter(
        offer =>
          offer.freshness ===
          "aging"
      ).length,

    stale:
      safeOffers.filter(
        offer =>
          offer.freshness ===
          "stale"
      ).length,

    unknown:
      safeOffers.filter(
        offer =>
          offer.freshness ===
          "unknown"
      ).length,

    needsRefresh:
      safeOffers.filter(
        offer =>
          offer.needsRefresh ===
          true
      ).length
  };
}


/*
 * =====================================================
 * CREATE A RETAILER ADAPTER
 *
 * Example:
 *
 * const adapter = createEvidenceRetailer({
 *   retailer: "Sprouts",
 *   market: "Knoxville, TN",
 *   address: "...",
 *   zip: "37922",
 *   evidence: SPROUTS_EVIDENCE,
 *   evidencePath: "bundled:data/sprouts-evidence.json"
 * });
 *
 * adapter.getOffers(request)
 * =====================================================
 */

function createEvidenceRetailer(
  config
) {
  if (
    !config ||
    !config.retailer
  ) {
    throw new Error(
      "Evidence retailer configuration requires a retailer name."
    );
  }


  const evidence =
    Array.isArray(
      config.evidence
    )
      ? config.evidence
      : [];


  function loadEvidence() {
    return {
      ok:
        evidence.length > 0,

      records:
        evidence,

      evidencePath:
        config.evidencePath ||
        null,

      error:
        config.evidenceLoadError ||
        null
    };
  }


  async function retrieveCandidates(
    request
  ) {
    const loaded =
      loadEvidence();


    if (
      !loaded.ok
    ) {
      return {
        source:
          "none",

        records:
          [],

        evidencePath:
          loaded.evidencePath,

        totalEvidenceRecords:
          0,

        loadError:
          loaded.error ||
          `${config.retailer} evidence could not be loaded.`
      };
    }


    const records =
      filterEvidenceRecords(
        loaded.records,
        request,
        config
      );


    return {
      source:
        records.length
          ? config.retrievalSource ||
            "retailer-evidence-file"
          : "evidence-file-no-match",

      records,

      evidencePath:
        loaded.evidencePath,

      totalEvidenceRecords:
        loaded.records.length,

      loadError:
        null
    };
  }


  async function getOffers(
    request
  ) {
    const retrieval =
      await retrieveCandidates(
        request
      );


    const result =
      buildEvidenceOffers({
        request,

        records:
          retrieval.records,

        config
      });


    const offers =
      result.offers;


    return {
      retailer:
        config.retailer,

      market: {
        retailer:
          config.retailer,

        city:
          config.city ||
          null,

        state:
          config.state ||
          null,

        zip:
          config.zip ||
          null,

        address:
          config.address ||
          null,

        market:
          config.market ||
          null
      },

      request,

      retrieval: {
        source:
          retrieval.source,

        evidencePath:
          retrieval.evidencePath,

        totalEvidenceRecords:
          retrieval
            .totalEvidenceRecords,

        recordCount:
          retrieval
            .records
            .length,

        acceptedCount:
          offers.length,

        loadError:
          retrieval.loadError,

        freshness:
          summarizeEvidenceFreshness(
            offers
          )
      },

      offers,

      winner:
        offers[0] ||
        null
    };
  }


  return {
    config,

    loadEvidence,

    retrieveCandidates,

    getOffers
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  CURRENT_MAX_DAYS,
  AGING_MAX_DAYS,

  cleanText,

  parseObservedDate,
  calculateAgeDays,
  getFreshnessStatus,

  scoreConfidence,

  filterEvidenceRecords,
  normalizeEvidenceRecord,
  buildEvidenceOffers,
  summarizeEvidenceFreshness,

  createEvidenceRetailer
};
