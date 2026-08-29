/*
 * aldi.js
 *
 * Thin ALDI wrapper around the shared
 * evidence-retailer engine.
 */

const {
  createEvidenceRetailer,
  getFreshnessStatus,
  calculateAgeDays
} = require("./evidence-retailer");


/*
 * =====================================================
 * LOAD ALDI EVIDENCE
 * =====================================================
 */

let ALDI_EVIDENCE = [];
let ALDI_EVIDENCE_LOAD_ERROR = null;


try {

  const loaded =
    require("../../../data/aldi-evidence.json");


  if (
    Array.isArray(
      loaded
    )
  ) {

    ALDI_EVIDENCE =
      loaded;

  } else {

    ALDI_EVIDENCE_LOAD_ERROR =
      "aldi-evidence.json loaded, but it does not contain a JSON array.";
  }

} catch (error) {

  ALDI_EVIDENCE_LOAD_ERROR =
    error.message;
}


/*
 * =====================================================
 * ALDI MARKET
 * =====================================================
 */

const ALDI_MARKET = {
  retailer:
    "ALDI",

  city:
    "Knoxville",

  state:
    "TN",

  zip:
    "37922",

  address:
    "110 Moss Grove Blvd",

  market:
    "Knoxville, TN"
};


/*
 * =====================================================
 * SHARED RETAILER ADAPTER
 * =====================================================
 */

const aldiAdapter =
  createEvidenceRetailer({
    retailer:
      "ALDI",

    city:
      ALDI_MARKET.city,

    state:
      ALDI_MARKET.state,

    zip:
      ALDI_MARKET.zip,

    address:
      ALDI_MARKET.address,

    market:
      ALDI_MARKET.market,

    evidence:
      ALDI_EVIDENCE,

    evidencePath:
      "bundled:data/aldi-evidence.json",

    evidenceLoadError:
      ALDI_EVIDENCE_LOAD_ERROR,

    retrievalSource:
      "aldi-evidence-file",

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

function loadAldiEvidence() {
  return (
    aldiAdapter
      .loadEvidence()
  );
}


async function retrieveAldiCandidates(
  request
) {
  return (
    aldiAdapter
      .retrieveCandidates(
        request
      )
  );
}


async function getAldiOffers(
  request
) {
  return (
    aldiAdapter
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
  ALDI_MARKET,

  loadAldiEvidence,

  retrieveAldiCandidates,

  getAldiOffers,

  getFreshnessStatus,

  calculateAgeDays
};
