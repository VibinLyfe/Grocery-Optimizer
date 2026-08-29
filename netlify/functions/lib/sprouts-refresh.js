/*
 * sprouts-refresh.js
 *
 * Sprouts-specific refresh / discovery adapter.
 *
 * This file does NOT scrape Sprouts and does NOT
 * perform web searches directly.
 *
 * It configures the shared evidence-refresh engine so
 * newly discovered Sprouts public evidence can be
 * validated and merged into sprouts-evidence.json.
 */

const {
  validateEvidenceCandidate,
  mergeEvidenceRecords,
  findMissingProducts,
  buildRefreshTargets,
  buildDiscoveryQueries
} = require("./evidence-refresh");


/*
 * =====================================================
 * SPROUTS MARKET
 * =====================================================
 */

const SPROUTS_REFRESH_MARKET = {
  retailer: "Sprouts",
  city: "Knoxville",
  state: "TN",
  zip: "37922",
  address: "9622 Kingston Pike",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * SPROUTS REFRESH CONFIG
 * =====================================================
 */

const SPROUTS_REFRESH_CONFIG = {
  retailer:
    SPROUTS_REFRESH_MARKET.retailer,

  city:
    SPROUTS_REFRESH_MARKET.city,

  state:
    SPROUTS_REFRESH_MARKET.state,

  zip:
    SPROUTS_REFRESH_MARKET.zip,

  address:
    SPROUTS_REFRESH_MARKET.address,

  market:
    SPROUTS_REFRESH_MARKET.market,

  minimumQualityScore:
    55,

  maxAgeDays:
    14,

  strongSourceTypes: [
    "retailer-product-page",
    "retailer-weekly-ad",
    "retailer-digital-ad",
    "public-product-record",
    "public-indexed-product-page"
  ]
};


/*
 * =====================================================
 * VALIDATE ONE SPROUTS RECORD
 * =====================================================
 */

function validateSproutsEvidence(
  record
) {
  return validateEvidenceCandidate(
    record,
    SPROUTS_REFRESH_CONFIG
  );
}


/*
 * =====================================================
 * MERGE DISCOVERED SPROUTS EVIDENCE
 * =====================================================
 */

function mergeSproutsEvidence({
  existingRecords,
  discoveredRecords
}) {
  return mergeEvidenceRecords({
    existingRecords,
    discoveredRecords,
    config:
      SPROUTS_REFRESH_CONFIG
  });
}


/*
 * =====================================================
 * FIND PRODUCTS WITH NO SPROUTS EVIDENCE
 * =====================================================
 */

function findMissingSproutsProducts({
  products,
  evidenceRecords
}) {
  return findMissingProducts({
    products,
    evidenceRecords,

    retailer:
      SPROUTS_REFRESH_MARKET
        .retailer
  });
}


/*
 * =====================================================
 * BUILD SPROUTS REFRESH TARGETS
 *
 * Targets include products whose evidence is:
 *
 * - missing
 * - aging
 * - stale
 * - unknown
 * =====================================================
 */

function buildSproutsRefreshTargets({
  products,
  evidenceRecords
}) {
  return buildRefreshTargets({
    products,
    evidenceRecords,

    retailer:
      SPROUTS_REFRESH_MARKET
        .retailer
  });
}


/*
 * =====================================================
 * BUILD DISCOVERY QUERIES
 *
 * These are query suggestions only.
 * This function does NOT execute searches.
 * =====================================================
 */

function buildSproutsDiscoveryQueries(
  product
) {
  return buildDiscoveryQueries({
    product,

    retailer:
      SPROUTS_REFRESH_MARKET
        .retailer,

    city:
      SPROUTS_REFRESH_MARKET
        .city,

    state:
      SPROUTS_REFRESH_MARKET
        .state
  });
}


/*
 * =====================================================
 * BUILD DISCOVERY PLAN
 * =====================================================
 */

function buildSproutsDiscoveryPlan({
  products,
  evidenceRecords
}) {
  const targets =
    buildSproutsRefreshTargets({
      products,
      evidenceRecords
    });

  return targets.map(
    target => ({
      product:
        target.product,

      reason:
        target.reason,

      freshness:
        target.freshness,

      queries:
        buildSproutsDiscoveryQueries(
          target.product
        )
    })
  );
}


/*
 * =====================================================
 * PREPARE DISCOVERED RECORD
 * =====================================================
 */

function prepareSproutsRecord(
  record
) {
  if (!record) {
    return null;
  }

  return {
    ...record,

    retailer:
      "Sprouts",

    market:
      record.market ||
      SPROUTS_REFRESH_MARKET
        .market,

    locationConfirmed:
      Boolean(
        record.locationConfirmed
      ),

    marketConfirmed:
      Boolean(
        record.marketConfirmed
      ),

    sourceType:
      record.sourceType ||
      "public-indexed-product-page"
  };
}


/*
 * =====================================================
 * PROCESS DISCOVERY BATCH
 * =====================================================
 */

function processSproutsDiscovery({
  existingRecords,
  discoveredRecords
}) {
  const prepared =
    (
      Array.isArray(
        discoveredRecords
      )
        ? discoveredRecords
        : []
    )
      .map(
        prepareSproutsRecord
      )
      .filter(Boolean);

  return mergeSproutsEvidence({
    existingRecords:
      Array.isArray(
        existingRecords
      )
        ? existingRecords
        : [],

    discoveredRecords:
      prepared
  });
}


/*
 * =====================================================
 * REFRESH SUMMARY
 * =====================================================
 */

function summarizeSproutsRefresh(
  result
) {
  const summary =
    result?.summary ||
    {};

  return {
    retailer:
      "Sprouts",

    existingCount:
      Number(
        summary.existingCount ||
        0
      ),

    discoveredCount:
      Number(
        summary.discoveredCount ||
        0
      ),

    acceptedNewCount:
      Number(
        summary.acceptedNewCount ||
        0
      ),

    rejectedNewCount:
      Number(
        summary.rejectedNewCount ||
        0
      ),

    finalRecordCount:
      Number(
        summary.finalRecordCount ||
        0
      )
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  SPROUTS_REFRESH_MARKET,
  SPROUTS_REFRESH_CONFIG,

  validateSproutsEvidence,

  mergeSproutsEvidence,

  findMissingSproutsProducts,

  buildSproutsRefreshTargets,

  buildSproutsDiscoveryQueries,

  buildSproutsDiscoveryPlan,

  prepareSproutsRecord,

  processSproutsDiscovery,

  summarizeSproutsRefresh
};
