/*
 * sprouts.js
 *
 * Sprouts retailer adapter for Grocery Optimizer.
 *
 * DATA SOURCE
 * -----------
 * data/sprouts-evidence.json
 *
 * This is dated retailer evidence, not a live Sprouts API.
 *
 * This adapter now handles:
 * - evidence loading
 * - canonical product filtering
 * - package normalization
 * - product match scoring
 * - confidence scoring
 * - package requirement math
 * - freshness / staleness tracking
 *
 * FRESHNESS RULES
 * ---------------
 * 0–7 days   -> current
 * 8–14 days  -> aging
 * 15+ days   -> stale
 */

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


/*
 * =====================================================
 * STATIC EVIDENCE IMPORT
 * =====================================================
 */

let SPROUTS_EVIDENCE = [];
let SPROUTS_EVIDENCE_LOAD_ERROR = null;


try {

  const loaded =
    require("../../../data/sprouts-evidence.json");


  if (
    Array.isArray(
      loaded
    )
  ) {

    SPROUTS_EVIDENCE =
      loaded;

  } else {

    SPROUTS_EVIDENCE_LOAD_ERROR =
      "sprouts-evidence.json loaded, but it does not contain a JSON array.";
  }

} catch (error) {

  SPROUTS_EVIDENCE_LOAD_ERROR =
    error.message;
}


/*
 * =====================================================
 * SPROUTS MARKET
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
 * FRESHNESS CONSTANTS
 * =====================================================
 */

const CURRENT_MAX_DAYS = 7;
const AGING_MAX_DAYS = 14;


/*
 * =====================================================
 * LOAD EVIDENCE
 * =====================================================
 */

function loadSproutsEvidence() {

  return {
    ok:
      Array.isArray(
        SPROUTS_EVIDENCE
      ) &&
      SPROUTS_EVIDENCE.length > 0,

    records:
      Array.isArray(
        SPROUTS_EVIDENCE
      )
        ? SPROUTS_EVIDENCE
        : [],

    evidencePath:
      "bundled:data/sprouts-evidence.json",

    error:
      SPROUTS_EVIDENCE_LOAD_ERROR
  };
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


/*
 * =====================================================
 * CALCULATE AGE IN DAYS
 * =====================================================
 */

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


  const diffMilliseconds =
    nowDate.getTime() -
    observed.getTime();


  /*
   * Future timestamps should not produce
   * negative ages.
   */

  const rawDays =
    diffMilliseconds /
    86400000;


  return Math.max(
    0,
    Math.floor(
      rawDays
    )
  );
}


/*
 * =====================================================
 * FRESHNESS STATUS
 *
 * Returns:
 *
 * {
 *   observedAt,
 *   ageDays,
 *   freshness,
 *   needsRefresh
 * }
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
 * Confidence measures reliability of the evidence,
 * separately from product match.
 * =====================================================
 */

function scoreConfidence(
  evidence
) {

  let score = 0;


  /*
   * Retailer identity
   */

  if (
    String(
      evidence.retailer ||
      ""
    )
      .trim()
      .toLowerCase() ===
    "sprouts"
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
   * Known package size
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
   * Freshness confidence
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

  if (
    [
      "retailer-product-page",
      "retailer-weekly-ad",
      "public-product-record"
    ].includes(
      evidence.sourceType
    )
  ) {

    score += 5;
  }


  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        score
      )
    )
  );
}


/*
 * =====================================================
 * RETRIEVE SPROUTS CANDIDATES
 * =====================================================
 */

async function retrieveSproutsCandidates(
  request,
  suppliedEvidence = []
) {

  const loaded =
    loadSproutsEvidence();


  const canonicalId =
    String(
      request
        ?.canonicalId ||
      ""
    ).trim();


  /*
   * ===================================================
   * PRIMARY:
   * sprouts-evidence.json
   * ===================================================
   */

  if (
    loaded.ok
  ) {

    const matchingRecords =
      loaded.records.filter(
        evidence => {

          if (
            !evidence
          ) {
            return false;
          }


          const retailer =
            String(
              evidence.retailer ||
              ""
            )
              .trim()
              .toLowerCase();


          if (
            retailer !==
            "sprouts"
          ) {
            return false;
          }


          if (
            canonicalId
          ) {

            const evidenceCanonicalId =
              String(
                evidence
                  .canonicalId ||
                ""
              ).trim();


            return (
              evidenceCanonicalId ===
              canonicalId
            );
          }


          return true;
        }
      );


    if (
      matchingRecords.length
    ) {

      return {
        source:
          "sprouts-evidence-file",

        records:
          matchingRecords,

        evidencePath:
          loaded.evidencePath,

        totalEvidenceRecords:
          loaded.records.length,

        loadError:
          null
      };
    }


    return {
      source:
        "sprouts-evidence-file-no-match",

      records:
        [],

      evidencePath:
        loaded.evidencePath,

      totalEvidenceRecords:
        loaded.records.length,

      loadError:
        null
    };
  }


  /*
   * ===================================================
   * FALLBACK
   * ===================================================
   */

  const fallback =
    Array.isArray(
      suppliedEvidence
    )
      ? suppliedEvidence
      : [];


  return {
    source:
      fallback.length
        ? "supplied-fallback"
        : "none",

    records:
      fallback,

    evidencePath:
      loaded.evidencePath,

    totalEvidenceRecords:
      0,

    loadError:
      loaded.error ||
      "Sprouts evidence could not be loaded."
  };
}


/*
 * =====================================================
 * NORMALIZE SPROUTS EVIDENCE
 * =====================================================
 */

function normalizeSproutsEvidence(
  evidence
) {

  if (
    !evidence
  ) {
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
          SPROUTS_MARKET.market,

        address:
          SPROUTS_MARKET.address,

        zip:
          SPROUTS_MARKET.zip,

        confirmed:
          Boolean(
            evidence.locationConfirmed
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
            evidence.marketConfirmed
          ),

        locationConfirmed:
          Boolean(
            evidence.locationConfirmed
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
        evidence.sourceType
    });


  /*
   * Preserve evidence metadata.
   */

  normalized.canonicalId =
    evidence.canonicalId ||
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


  normalized.rawSize =
    evidence.size ||
    null;


  /*
   * Freshness metadata
   */

  normalized.ageDays =
    freshness.ageDays;


  normalized.freshness =
    freshness.freshness;


  normalized.needsRefresh =
    freshness.needsRefresh;


  return normalized;
}


/*
 * =====================================================
 * GET SPROUTS OFFERS
 * =====================================================
 */

async function getSproutsOffers(
  request,
  suppliedEvidence = []
) {

  const retrieval =
    await retrieveSproutsCandidates(
      request,
      suppliedEvidence
    );


  const rawCandidates =
    retrieval.records ||
    [];


  const offers = [];


  /*
   * ===================================================
   * NORMALIZE / SCORE / PLAN
   * ===================================================
   */

  for (
    const candidate of
    rawCandidates
  ) {

    const normalized =
      normalizeSproutsEvidence(
        candidate
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
     * Reject incompatible packages,
     * weak matches and unusable evidence.
     *
     * STALE evidence is NOT automatically rejected.
     * We keep it available, but flag it clearly.
     */

    if (
      !packagePlan ||
      matchScore < 60 ||
      normalized
        .confidenceScore <
        30
    ) {
      continue;
    }


    offers.push({
      retailer:
        "Sprouts",

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
   * ===================================================
   * SORT
   *
   * 1. lowest actual purchase cost
   * 2. fresher evidence
   * 3. stronger product match
   * 4. stronger confidence
   * ===================================================
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


  /*
   * ===================================================
   * RETRIEVAL-LEVEL FRESHNESS SUMMARY
   * ===================================================
   */

  const refreshNeededCount =
    offers.filter(
      offer =>
        offer.needsRefresh ===
        true
    ).length;


  const currentCount =
    offers.filter(
      offer =>
        offer.freshness ===
        "current"
    ).length;


  const agingCount =
    offers.filter(
      offer =>
        offer.freshness ===
        "aging"
    ).length;


  const staleCount =
    offers.filter(
      offer =>
        offer.freshness ===
        "stale"
    ).length;


  /*
   * ===================================================
   * RESPONSE
   * ===================================================
   */

  return {
    retailer:
      "Sprouts",

    market:
      SPROUTS_MARKET,

    request,

    retrieval: {
      source:
        retrieval.source,

      evidencePath:
        retrieval.evidencePath ||
        null,

      totalEvidenceRecords:
        retrieval.totalEvidenceRecords ??
        null,

      recordCount:
        rawCandidates.length,

      acceptedCount:
        offers.length,

      loadError:
        retrieval.loadError ||
        null,

      freshness: {
        current:
          currentCount,

        aging:
          agingCount,

        stale:
          staleCount,

        needsRefresh:
          refreshNeededCount
      }
    },

    offers,

    winner:
      offers[0] ||
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

  CURRENT_MAX_DAYS,

  AGING_MAX_DAYS,

  loadSproutsEvidence,

  parseObservedDate,

  calculateAgeDays,

  getFreshnessStatus,

  scoreConfidence,

  retrieveSproutsCandidates,

  normalizeSproutsEvidence,

  getSproutsOffers
};
