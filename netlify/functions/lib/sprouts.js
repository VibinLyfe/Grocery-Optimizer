/*
 * sprouts.js
 *
 * Sprouts retailer adapter for Grocery Optimizer.
 *
 * Sprouts pricing is loaded from the repository file:
 *
 * data/sprouts-evidence.json
 *
 * IMPORTANT:
 * The evidence JSON is imported as a STATIC dependency.
 * This allows Netlify's function bundler to include the
 * file reliably instead of depending on runtime paths.
 */

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


/*
 * =====================================================
 * STATIC SPROUTS EVIDENCE IMPORT
 * =====================================================
 *
 * sprouts.js lives at:
 *
 * netlify/functions/lib/sprouts.js
 *
 * therefore:
 *
 * ../../../data/sprouts-evidence.json
 *
 * reaches the repository-level data folder.
 *
 * Because this require() uses a literal path, Netlify
 * can discover and bundle the JSON during deployment.
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
 * CONFIDENCE SCORE
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

  if (
    evidence.observedAt
  ) {

    const observed =
      new Date(
        evidence.observedAt
      );


    if (
      !Number.isNaN(
        observed.getTime()
      )
    ) {

      const ageHours =
        (
          Date.now() -
          observed.getTime()
        ) /
        3600000;


      if (
        ageHours <= 24
      ) {

        score += 20;

      } else if (
        ageHours <= 72
      ) {

        score += 15;

      } else if (
        ageHours <= 168
      ) {

        score += 10;

      } else if (
        ageHours <= 720
      ) {

        score += 5;
      }
    }
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
   * bundled sprouts-evidence.json
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


          /*
           * Require exact canonical product match
           * whenever the request contains one.
           */

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


    /*
     * Use real evidence only if a matching product
     * exists in the evidence file.
     */

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


    /*
     * Evidence file loaded correctly, but the
     * requested canonical product is not present.
     */

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
   *
   * Only used if the bundled evidence file itself
   * could not be loaded.
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
 * NORMALIZE ONE SPROUTS RECORD
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


  /*
   * Preserve the human-readable package size from
   * the evidence file for the front end.
   */

  normalized.rawSize =
    evidence.size ||
    null;


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
   * NORMALIZE / MATCH / CONFIDENCE / PACKAGE PLAN
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
     * Reject:
     *
     * - incompatible package units
     * - weak product matches
     * - very low-confidence evidence
     */

    if (
      !packagePlan ||
      matchScore < 60 ||
      normalized
        .confidenceScore <
        40
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
   * 1. lowest actual cost to fulfill request
   * 2. strongest match
   * 3. strongest confidence
   * ===================================================
   */

  offers.sort(
    (a, b) =>
      a.totalCost -
        b.totalCost ||
      b.matchScore -
        a.matchScore ||
      b.confidenceScore -
        a.confidenceScore
  );


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
        null
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

  loadSproutsEvidence,

  scoreConfidence,

  retrieveSproutsCandidates,

  normalizeSproutsEvidence,

  getSproutsOffers
};
