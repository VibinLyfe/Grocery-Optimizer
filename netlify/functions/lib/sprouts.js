/*
 * sprouts.js
 *
 * Sprouts retailer adapter.
 *
 * Retrieval order:
 *
 * 1. Stored dated Sprouts evidence
 * 2. Dynamic public-search fallback
 *
 * IMPORTANT:
 * The dynamic adapter currently has no permitted
 * live provider configured, so today the practical
 * fallback is still the evidence-refresh workflow.
 */

const fs = require("fs");
const path = require("path");

const {
  createEvidenceRetailer,
  getFreshnessStatus,
  calculateAgeDays
} = require("./evidence-retailer");

const {
  searchSproutsDynamic,
  buildSproutsDynamicStatus
} = require("./sprouts-dynamic");


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
 * SPROUTS EVIDENCE CONFIG
 * =====================================================
 */

const sproutsEvidenceAdapter =
  createEvidenceRetailer({
    retailer: "Sprouts",

    market:
      SPROUTS_MARKET,

    minimumMatchScore:
      60,

    minimumConfidenceScore:
      55,

    trustedSourceTypes: [
      "retailer-product-page",
      "retailer-weekly-ad",
      "retailer-digital-ad",
      "public-product-record",
      "public-indexed-product-page"
    ]
  });


/*
 * =====================================================
 * LOAD EVIDENCE FILE
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
        fs.existsSync(
          filePath
        )
      ) {
        const parsed =
          JSON.parse(
            fs.readFileSync(
              filePath,
              "utf8"
            )
          );

        return Array.isArray(
          parsed
        )
          ? parsed
          : [];
      }

    } catch (
      error
    ) {
      /*
       * Try the next possible path.
       */
    }
  }


  return [];
}


/*
 * =====================================================
 * RETRIEVE EVIDENCE CANDIDATES
 * =====================================================
 */

function retrieveSproutsCandidates(
  request
) {
  const records =
    loadSproutsEvidence();

  return sproutsEvidenceAdapter
    .getOffers(
      request,
      records
    );
}


/*
 * =====================================================
 * BUILD EVIDENCE RESULT
 * =====================================================
 */

function buildEvidenceResult(
  adapterResult
) {
  const offers =
    Array.isArray(
      adapterResult?.offers
    )
      ? adapterResult.offers
      : [];

  const retrieval =
    adapterResult?.retrieval ||
    {};


  return {
    retailer:
      "Sprouts",

    market:
      SPROUTS_MARKET,

    offers,

    retrieval: {
      source:
        retrieval.source ||
        (
          offers.length
            ? "sprouts-evidence-file"
            : "evidence-file-no-match"
        ),

      recordCount:
        Number(
          retrieval.recordCount ||
          0
        ),

      acceptedCount:
        Number(
          retrieval.acceptedCount ||
          offers.length
        ),

      freshness:
        retrieval.freshness ||
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
 * EVIDENCE FRESHNESS SUMMARY
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
    Array.isArray(
      offers
    )
      ? offers
      : [];


  for (
    const offer of
    safeOffers
  ) {
    let freshness =
      offer?.freshness ||
      null;


    if (!freshness) {
      const status =
        getFreshnessStatus(
          offer?.observedAt ||
          offer?.source
            ?.observedAt ||
          null
        );

      freshness =
        status?.freshness ||
        "unknown";
    }


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


    let needsRefresh =
      offer?.needsRefresh;


    if (
      typeof needsRefresh !==
      "boolean"
    ) {
      const status =
        getFreshnessStatus(
          offer?.observedAt ||
          offer?.source
            ?.observedAt ||
          null
        );

      needsRefresh =
        Boolean(
          status?.needsRefresh
        );
    }


    if (
      needsRefresh
    ) {
      summary.needsRefresh +=
        1;
    }
  }


  return summary;
}


/*
 * =====================================================
 * NORMALIZE DYNAMIC RESULT
 * =====================================================
 */

function normalizeDynamicResult(
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

    offers,

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
 * MAIN SPROUTS RETRIEVAL
 * =====================================================
 */

async function getSproutsOffers(
  request
) {

  /*
   * ---------------------------------------------
   * STEP 1:
   * Look for acceptable stored evidence.
   * ---------------------------------------------
   */

  const evidenceRaw =
    retrieveSproutsCandidates(
      request
    );

  const evidenceResult =
    buildEvidenceResult(
      evidenceRaw
    );


  if (
    evidenceResult.offers.length
  ) {
    return evidenceResult;
  }


  /*
   * ---------------------------------------------
   * STEP 2:
   * No valid stored evidence.
   *
   * Attempt dynamic fallback.
   *
   * At present, sprouts-dynamic.js intentionally
   * has searchProvider = null, so this should fail
   * safely instead of inventing a result.
   * ---------------------------------------------
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


  const dynamicNormalized =
    normalizeDynamicResult(
      dynamicResult
    );


  /*
   * ---------------------------------------------
   * STEP 3:
   * If dynamic search produced acceptable offers,
   * return those.
   * ---------------------------------------------
   */

  if (
    dynamicNormalized.offers.length
  ) {
    return dynamicNormalized;
  }


  /*
   * ---------------------------------------------
   * STEP 4:
   * Neither evidence nor dynamic search produced
   * an acceptable result.
   *
   * Preserve the original evidence response but
   * expose dynamic-fallback status.
   * ---------------------------------------------
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
 * OPTIONAL STATUS HELPER
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

  const observedDates =
    offers
      .map(
        offer =>
          offer.observedAt ||
          offer.source
            ?.observedAt ||
          null
      )
      .filter(Boolean);

  let newestObservedAt =
    null;


  for (
    const observedAt of
    observedDates
  ) {
    const age =
      calculateAgeDays(
        observedAt
      );

    if (
      age === null
    ) {
      continue;
    }

    if (
      newestObservedAt ===
      null
    ) {
      newestObservedAt =
        observedAt;
      continue;
    }

    const currentAge =
      calculateAgeDays(
        newestObservedAt
      );

    if (
      currentAge === null ||
      age < currentAge
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

  sproutsEvidenceAdapter,

  loadSproutsEvidence,

  retrieveSproutsCandidates,

  getSproutsOffers,

  buildSproutsStatus
};
