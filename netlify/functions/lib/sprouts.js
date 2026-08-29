/*
 * sprouts.js
 *
 * Sprouts retailer adapter for Grocery Optimizer.
 *
 * DATA FLOW
 * ---------
 *
 * data/sprouts-evidence.json
 *          ↓
 * retrieveSproutsCandidates()
 *          ↓
 * normalizeSproutsEvidence()
 *          ↓
 * scoreProductMatch()
 *          ↓
 * calculatePackageRequirement()
 *          ↓
 * getSproutsOffers()
 *
 * IMPORTANT
 * ---------
 *
 * This is NOT a live Sprouts API.
 *
 * It reads dated retailer evidence stored in:
 *
 * data/sprouts-evidence.json
 *
 * The evidence file can be refreshed later without
 * changing the comparison / normalization architecture.
 */


const fs = require("fs");
const path = require("path");


const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


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
 * EVIDENCE FILE
 * =====================================================
 */

function getEvidencePath() {
  return path.join(
    process.cwd(),
    "data",
    "sprouts-evidence.json"
  );
}


/*
 * =====================================================
 * LOAD EVIDENCE FILE
 *
 * Returns:
 *
 * {
 *   ok: true,
 *   records: [...]
 * }
 *
 * or:
 *
 * {
 *   ok: false,
 *   records: [],
 *   error: "..."
 * }
 * =====================================================
 */

function loadSproutsEvidence() {
  try {

    const evidencePath =
      getEvidencePath();


    if (
      !fs.existsSync(
        evidencePath
      )
    ) {
      return {
        ok: false,

        records: [],

        error:
          "Sprouts evidence file was not found."
      };
    }


    const raw =
      fs.readFileSync(
        evidencePath,
        "utf8"
      );


    const parsed =
      JSON.parse(raw);


    if (
      !Array.isArray(
        parsed
      )
    ) {
      return {
        ok: false,

        records: [],

        error:
          "Sprouts evidence file must contain a JSON array."
      };
    }


    return {
      ok: true,

      records:
        parsed,

      error:
        null
    };


  } catch (error) {

    return {
      ok: false,

      records: [],

      error:
        error.message
    };
  }
}


/*
 * =====================================================
 * CONFIDENCE SCORE
 *
 * Confidence answers:
 *
 * "How trustworthy and current is this price evidence?"
 *
 * This is separate from product match.
 *
 * Possible points:
 *
 * retailer known       +20
 * valid price          +20
 * package size known   +15
 * exact store          +20
 * Knoxville market     +10
 * freshness            +20 max
 * strong source type   +5
 *
 * Maximum = 100
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
    evidence.retailer ===
    "Sprouts"
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

        /*
         * Within one week
         */

        score += 10;

      } else if (
        ageHours <= 720
      ) {

        /*
         * Within roughly 30 days
         */

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
 *
 * PRIMARY SOURCE:
 *
 * data/sprouts-evidence.json
 *
 * The request produced by normalize.js includes:
 *
 * request.canonicalId
 *
 * Example:
 *
 * organic-broccoli
 *
 * We only return evidence records for that product.
 *
 * suppliedEvidence remains as a fallback so the app
 * does not completely fail if the JSON file cannot
 * temporarily be loaded.
 * =====================================================
 */

async function retrieveSproutsCandidates(
  request,
  suppliedEvidence = []
) {

  const loaded =
    loadSproutsEvidence();


  const canonicalId =
    request
      ?.canonicalId ||
    null;


  /*
   * -----------------------------------------------
   * PRIMARY:
   * sprouts-evidence.json
   * -----------------------------------------------
   */

  if (
    loaded.ok &&
    loaded.records.length
  ) {

    const matchingRecords =
      loaded.records.filter(
        evidence => {

          if (
            !evidence
          ) {
            return false;
          }


          /*
           * Must actually be Sprouts.
           */

          if (
            String(
              evidence.retailer ||
              ""
            ).toLowerCase() !==
            "sprouts"
          ) {
            return false;
          }


          /*
           * If we have a canonical ID,
           * require an exact canonical match.
           */

          if (
            canonicalId
          ) {
            return (
              evidence
                .canonicalId ===
              canonicalId
            );
          }


          return true;
        }
      );


    /*
     * If our real evidence file contains
     * records for this item, use ONLY those.
     *
     * We intentionally do not mix them with
     * prototype seed prices.
     */

    if (
      matchingRecords.length
    ) {
      return {
        source:
          "sprouts-evidence-file",

        records:
          matchingRecords,

        loadError:
          null
      };
    }
  }


  /*
   * -----------------------------------------------
   * FALLBACK:
   * supplied evidence
   *
   * This protects the app if:
   *
   * - JSON file is temporarily unavailable
   * - product has not been added to it yet
   *
   * compare.js currently supplies legacy prototype
   * evidence, so this keeps the app functional.
   * -----------------------------------------------
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

    loadError:
      loaded.error ||
      null
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
          SPROUTS_MARKET
            .market,

        address:
          SPROUTS_MARKET
            .address,

        zip:
          SPROUTS_MARKET
            .zip,

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


  normalized
    .confidenceScore =
    scoreConfidence({
      retailer:
        "Sprouts",

      price:
        evidence.price,

      size:
        evidence.size,

      locationConfirmed:
        evidence
          .locationConfirmed,

      marketConfirmed:
        evidence
          .marketConfirmed,

      observedAt:
        evidence
          .observedAt,

      sourceType:
        evidence
          .sourceType
    });


  /*
   * Preserve useful source fields
   * for the response / front end.
   */

  normalized
    .canonicalId =
    evidence
      .canonicalId ||
    null;


  normalized
    .observedAt =
    evidence
      .observedAt ||
    null;


  normalized
    .sourceType =
    evidence
      .sourceType ||
    "public-web-evidence";


  normalized
    .sourceUrl =
    evidence
      .sourceUrl ||
    null;


  return normalized;
}


/*
 * =====================================================
 * GET SPROUTS OFFERS
 *
 * Main public function used by compare.js.
 * =====================================================
 */

async function getSproutsOffers(
  request,
  suppliedEvidence = []
) {

  /*
   * -----------------------------------------------
   * RETRIEVE
   * -----------------------------------------------
   */

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
   * -----------------------------------------------
   * NORMALIZE + SCORE
   * -----------------------------------------------
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
     * - incompatible units
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
        normalized
          .canonicalId,

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
        normalized
          .sourceType,

      observedAt:
        normalized
          .observedAt,

      matchScore,

      confidenceScore:
        normalized
          .confidenceScore,

      purchasePlan:
        packagePlan,

      totalCost:
        packagePlan
          .totalCost
    });
  }


  /*
   * -----------------------------------------------
   * BEST ACTUAL PURCHASE COST FIRST
   *
   * Tie breakers:
   *
   * 1. stronger match
   * 2. stronger evidence confidence
   * -----------------------------------------------
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
   * -----------------------------------------------
   * RESPONSE
   * -----------------------------------------------
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

      recordCount:
        rawCandidates
          .length,

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

  getEvidencePath,

  loadSproutsEvidence,

  scoreConfidence,

  retrieveSproutsCandidates,

  normalizeSproutsEvidence,

  getSproutsOffers
};
