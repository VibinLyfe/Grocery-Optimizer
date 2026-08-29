const {
  createEvidenceRetailer,
  getFreshnessStatus,
  calculateAgeDays
} = require("./evidence-retailer");

const {
  searchEarthFareDynamic,
  buildEarthFareDynamicStatus
} = require("./earthfare-dynamic");


/*
 * =====================================================
 * LOAD EARTH FARE EVIDENCE
 * =====================================================
 */

let EARTH_FARE_EVIDENCE = [];
let EARTH_FARE_EVIDENCE_LOAD_ERROR = null;

try {
  const loaded =
    require("../../../data/earthfare-evidence.json");

  if (
    Array.isArray(loaded)
  ) {
    EARTH_FARE_EVIDENCE =
      loaded;

  } else {
    EARTH_FARE_EVIDENCE_LOAD_ERROR =
      "earthfare-evidence.json loaded, but it does not contain a JSON array.";
  }

} catch (
  error
) {
  EARTH_FARE_EVIDENCE_LOAD_ERROR =
    error.message;
}


/*
 * =====================================================
 * EARTH FARE MARKET
 * =====================================================
 */

const EARTH_FARE_MARKET = {
  retailer:
    "Earth Fare",

  city:
    "Knoxville",

  state:
    "TN",

  zip:
    "37934",

  address:
    "10903 Parkside Dr",

  market:
    "Knoxville, TN"
};


/*
 * =====================================================
 * STATIC EVIDENCE ADAPTER
 * =====================================================
 */

const earthFareEvidenceAdapter =
  createEvidenceRetailer({
    retailer:
      "Earth Fare",

    city:
      EARTH_FARE_MARKET.city,

    state:
      EARTH_FARE_MARKET.state,

    zip:
      EARTH_FARE_MARKET.zip,

    address:
      EARTH_FARE_MARKET.address,

    market:
      EARTH_FARE_MARKET.market,

    evidence:
      EARTH_FARE_EVIDENCE,

    evidencePath:
      "bundled:data/earthfare-evidence.json",

    evidenceLoadError:
      EARTH_FARE_EVIDENCE_LOAD_ERROR,

    retrievalSource:
      "earthfare-evidence-file",

    minimumMatchScore:
      60,

    minimumConfidenceScore:
      30,

    strongSourceTypes: [
      "retailer-product-page",
      "retailer-weekly-ad",
      "public-product-record"
    ]
  });


/*
 * =====================================================
 * EXISTING EVIDENCE HELPERS
 * =====================================================
 */

function loadEarthFareEvidence() {
  return earthFareEvidenceAdapter
    .loadEvidence();
}


async function retrieveEarthFareCandidates(
  request
) {
  return earthFareEvidenceAdapter
    .retrieveCandidates(
      request
    );
}


/*
 * =====================================================
 * EVIDENCE + DYNAMIC FALLBACK
 *
 * Flow:
 *
 * 1. Existing Earth Fare evidence first
 * 2. If evidence produces a valid offer, return it
 * 3. If evidence has no accepted offers, try dynamic
 * 4. If dynamic produces valid offers, return those
 * 5. Otherwise return the original evidence response
 *
 * Nothing is invented.
 * =====================================================
 */

async function getEarthFareOffers(
  request
) {
  const evidenceResult =
    await earthFareEvidenceAdapter
      .getOffers(
        request
      );


  const evidenceOffers =
    Array.isArray(
      evidenceResult?.offers
    )
      ? evidenceResult.offers
      : [];


  /*
   * Existing evidence remains authoritative
   * whenever it produces one or more valid offers.
   */

  if (
    evidenceOffers.length > 0
  ) {
    return {
      ...evidenceResult,

      retrieval: {
        ...evidenceResult.retrieval,

        primarySource:
          "earthfare-evidence-file",

        fallbackAttempted:
          false,

        fallbackSource:
          null,

        fallbackAcceptedCount:
          0
      },

      dynamic:
        null
    };
  }


  /*
   * No valid evidence match.
   * Try the dynamic adapter.
   */

  const dynamicResult =
    await searchEarthFareDynamic(
      request
    );


  const dynamicOffers =
    Array.isArray(
      dynamicResult?.offers
    )
      ? dynamicResult.offers
      : [];


  const dynamicStatus =
    buildEarthFareDynamicStatus(
      dynamicResult
    );


  /*
   * If the dynamic layer returns valid offers,
   * those become the Earth Fare results.
   */

  if (
    dynamicOffers.length > 0
  ) {
    return {
      retailer:
        "Earth Fare",

      market:
        EARTH_FARE_MARKET,

      request,

      retrieval: {
        source:
          dynamicResult
            ?.retrieval
            ?.source ||
          "earthfare-dynamic-search",

        primarySource:
          evidenceResult
            ?.retrieval
            ?.source ||
          "earthfare-evidence-file",

        evidencePath:
          evidenceResult
            ?.retrieval
            ?.evidencePath ||
          "bundled:data/earthfare-evidence.json",

        totalEvidenceRecords:
          Number(
            evidenceResult
              ?.retrieval
              ?.totalEvidenceRecords ||
            0
          ),

        recordCount:
          Number(
            dynamicResult
              ?.retrieval
              ?.recordCount ||
            0
          ),

        acceptedCount:
          dynamicOffers.length,

        loadError:
          evidenceResult
            ?.retrieval
            ?.loadError ||
          null,

        fallbackAttempted:
          true,

        fallbackSource:
          dynamicResult
            ?.retrieval
            ?.source ||
          null,

        fallbackAcceptedCount:
          dynamicOffers.length,

        dynamicStatus
      },

      offers:
        dynamicOffers,

      winner:
        dynamicOffers[0] ||
        null,

      dynamic:
        dynamicResult
    };
  }


  /*
   * Dynamic fallback also found nothing.
   *
   * Return the original evidence result so the rest of
   * the application continues to receive the familiar
   * Earth Fare response shape.
   */

  return {
    ...evidenceResult,

    retrieval: {
      ...evidenceResult.retrieval,

      primarySource:
        evidenceResult
          ?.retrieval
          ?.source ||
        "earthfare-evidence-file",

      fallbackAttempted:
        Boolean(
          dynamicResult
            ?.retrieval
            ?.attempted
        ),

      fallbackSource:
        dynamicResult
          ?.retrieval
          ?.source ||
        null,

      fallbackAcceptedCount:
        dynamicOffers.length,

      dynamicStatus
    },

    dynamic:
      dynamicResult
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  EARTH_FARE_MARKET,

  loadEarthFareEvidence,

  retrieveEarthFareCandidates,

  getEarthFareOffers,

  getFreshnessStatus,

  calculateAgeDays
};
