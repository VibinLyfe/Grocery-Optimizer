/*
 * earthfare.js
 *
 * Thin Earth Fare wrapper around the shared
 * evidence-retailer engine.
 */

const {
  createEvidenceRetailer,
  getFreshnessStatus,
  calculateAgeDays
} = require("./evidence-retailer");


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
    Array.isArray(
      loaded
    )
  ) {

    EARTH_FARE_EVIDENCE =
      loaded;

  } else {

    EARTH_FARE_EVIDENCE_LOAD_ERROR =
      "earthfare-evidence.json loaded, but it does not contain a JSON array.";
  }

} catch (error) {

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
 * SHARED RETAILER ADAPTER
 * =====================================================
 */

const earthFareAdapter =
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
 * COMPATIBILITY FUNCTIONS
 * =====================================================
 */

function loadEarthFareEvidence() {
  return (
    earthFareAdapter
      .loadEvidence()
  );
}


async function retrieveEarthFareCandidates(
  request
) {
  return (
    earthFareAdapter
      .retrieveCandidates(
        request
      )
  );
}


async function getEarthFareOffers(
  request
) {
  return (
    earthFareAdapter
      .getOffers(
        request
      )
  );
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
