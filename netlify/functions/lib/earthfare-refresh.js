/*
 * earthfare-refresh.js
 *
 * Earth Fare-specific refresh / discovery adapter.
 *
 * This file does NOT scrape Earth Fare and does NOT
 * perform web searches directly.
 *
 * It configures the shared evidence-refresh engine so
 * newly discovered Earth Fare public evidence can be
 * validated and merged into earthfare-evidence.json.
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
 * EARTH FARE MARKET
 * =====================================================
 */

const EARTH_FARE_REFRESH_MARKET = {
  retailer: "Earth Fare",
  city: "Knoxville",
  state: "TN",
  zip: "37934",
  address: "10903 Parkside Dr",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * EARTH FARE REFRESH CONFIG
 * =====================================================
 */

const EARTH_FARE_REFRESH_CONFIG = {
  retailer:
    EARTH_FARE_REFRESH_MARKET.retailer,

  city:
    EARTH_FARE_REFRESH_MARKET.city,

  state:
    EARTH_FARE_REFRESH_MARKET.state,

  zip:
    EARTH_FARE_REFRESH_MARKET.zip,

  address:
    EARTH_FARE_REFRESH_MARKET.address,

  market:
    EARTH_FARE_REFRESH_MARKET.market,

  /*
   * Refresh evidence must be reasonably strong.
   *
   * 55 allows:
   * retailer + price + size + trusted public source
   *
   * while still rejecting very weak or incomplete
   * records.
   */

  minimumQualityScore:
    55,

  /*
   * We do not want newly discovered pricing older
   * than two weeks entering the evidence file.
   */

  maxAgeDays:
    14,

  strongSourceTypes: [
    "retailer-product-page",
    "retailer-weekly-ad",
    "retailer-daily-deal",
    "public-product-record",
    "public-indexed-product-page"
  ]
};


/*
 * =====================================================
 * VALIDATE ONE EARTH FARE RECORD
 * =====================================================
 */

function validateEarthFareEvidence(
  record
) {
  return validateEvidenceCandidate(
    record,
    EARTH_FARE_REFRESH_CONFIG
  );
}


/*
 * =====================================================
 * MERGE DISCOVERED EARTH FARE EVIDENCE
 *
 * existingRecords:
 * current earthfare-evidence.json
 *
 * discoveredRecords:
 * newly verified public evidence
 *
 * Returns the complete merged array.
 * =====================================================
 */

function mergeEarthFareEvidence({
  existingRecords,
  discoveredRecords
}) {
  return mergeEvidenceRecords({
    existingRecords,
    discoveredRecords,
    config:
      EARTH_FARE_REFRESH_CONFIG
  });
}


/*
 * =====================================================
 * FIND PRODUCTS WITH NO EARTH FARE EVIDENCE
 * =====================================================
 */

function findMissingEarthFareProducts({
  products,
  evidenceRecords
}) {
  return findMissingProducts({
    products,
    evidenceRecords,

    retailer:
      EARTH_FARE_REFRESH_MARKET
        .retailer
  });
}


/*
 * =====================================================
 * BUILD EARTH FARE REFRESH TARGETS
 *
 * Targets include products whose evidence is:
 *
 * - missing
 * - aging
 * - stale
 * - unknown
 * =====================================================
 */

function buildEarthFareRefreshTargets({
  products,
  evidenceRecords
}) {
  return buildRefreshTargets({
    products,
    evidenceRecords,

    retailer:
      EARTH_FARE_REFRESH_MARKET
        .retailer
  });
}


/*
 * =====================================================
 * BUILD DISCOVERY QUERIES
 *
 * These are query suggestions only.
 *
 * This function does NOT execute those searches.
 * =====================================================
 */

function buildEarthFareDiscoveryQueries(
  product
) {
  return buildDiscoveryQueries({
    product,

    retailer:
      EARTH_FARE_REFRESH_MARKET
        .retailer,

    city:
      EARTH_FARE_REFRESH_MARKET
        .city,

    state:
      EARTH_FARE_REFRESH_MARKET
        .state
  });
}


/*
 * =====================================================
 * BUILD DISCOVERY PLAN
 *
 * Useful for a scheduled refresh workflow.
 *
 * Given the product catalog and current Earth Fare
 * evidence, this produces every product that should
 * be researched plus its suggested discovery queries.
 * =====================================================
 */

function buildEarthFareDiscoveryPlan({
  products,
  evidenceRecords
}) {
  const targets =
    buildEarthFareRefreshTargets({
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
        buildEarthFareDiscoveryQueries(
          target.product
        )
    })
  );
}


/*
 * =====================================================
 * PREPARE DISCOVERED RECORD
 *
 * Convenience helper for refresh jobs.
 *
 * This ensures basic Earth Fare market information
 * is present before the shared validator sees it.
 * =====================================================
 */

function prepareEarthFareRecord(
  record
) {
  if (!record) {
    return null;
  }

  return {
    ...record,

    retailer:
      "Earth Fare",

    market:
      record.market ||
      EARTH_FARE_REFRESH_MARKET
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
 *
 * Takes raw discovered evidence, applies Earth Fare
 * defaults, validates it, and merges accepted records
 * into the current evidence array.
 * =====================================================
 */

function processEarthFareDiscovery({
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
        prepareEarthFareRecord
      )
      .filter(Boolean);

  return mergeEarthFareEvidence({
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

function summarizeEarthFareRefresh(
  result
) {
  const summary =
    result?.summary ||
    {};

  return {
    retailer:
      "Earth Fare",

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
  EARTH_FARE_REFRESH_MARKET,
  EARTH_FARE_REFRESH_CONFIG,

  validateEarthFareEvidence,

  mergeEarthFareEvidence,

  findMissingEarthFareProducts,

  buildEarthFareRefreshTargets,

  buildEarthFareDiscoveryQueries,

  buildEarthFareDiscoveryPlan,

  prepareEarthFareRecord,

  processEarthFareDiscovery,

  summarizeEarthFareRefresh
};
