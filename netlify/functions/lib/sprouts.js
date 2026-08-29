/*
 * sprouts.js
 *
 * Thin Sprouts wrapper around the shared
 * evidence-retailer engine.
 *
 * Shared logic now lives in:
 *
 * netlify/functions/lib/evidence-retailer.js
 */

const {
  createEvidenceRetailer,
  getFreshnessStatus,
  calculateAgeDays
} = require("./evidence-retailer");


/*
 * =====================================================
 * LOAD SPROUTS EVIDENCE
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
  retailer:
    "Sprouts",

  city:
    "Knoxville",

  state:
    "TN",

  zip:
    "37922",

  address:
    "9622 Kingston Pike",

  market:
    "Knoxville, TN"
};


/*
 * =====================================================
 * SHARED RETAILER ADAPTER
 * =====================================================
 */

const sproutsAdapter =
  createEvidenceRetailer({
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

    evidence:
      SPROUTS_EVIDENCE,

    evidencePath:
      "bundled:data/sprouts-evidence.json",

    evidenceLoadError:
      SPROUTS_EVIDENCE_LOAD_ERROR,

    retrievalSource:
      "sprouts-evidence-file",

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
 *
 * compare.js already expects getSproutsOffers(),
 * so we preserve that interface.
 * =====================================================
 */

function loadSproutsEvidence() {
  return (
    sproutsAdapter
      .loadEvidence()
  );
}


async function retrieveSproutsCandidates(
  request
) {
  return (
    sproutsAdapter
      .retrieveCandidates(
        request
      )
  );
}


async function getSproutsOffers(
  request
) {
  return (
    sproutsAdapter
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
  SPROUTS_MARKET,

  loadSproutsEvidence,

  retrieveSproutsCandidates,

  getSproutsOffers,

  getFreshnessStatus,

  calculateAgeDays
};
