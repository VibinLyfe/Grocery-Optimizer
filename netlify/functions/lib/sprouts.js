/*
 * sprouts.js
 *
 * Sprouts retailer adapter for Grocery Optimizer.
 *
 * PURPOSE
 * -------
 * Load dated Sprouts evidence from:
 *
 * data/sprouts-evidence.json
 *
 * Then:
 * 1. filter evidence to the requested canonical product
 * 2. normalize package size
 * 3. score product match
 * 4. score confidence/freshness
 * 5. calculate actual package requirement
 *
 * IMPORTANT
 * ---------
 * This is not a live Sprouts API.
 *
 * The goal of this version is also to make the evidence
 * file path robust inside Netlify's bundled function
 * environment.
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
  retailer: "Sprouts",
  city: "Knoxville",
  state: "TN",
  zip: "37922",
  address: "9622 Kingston Pike",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * POSSIBLE EVIDENCE PATHS
 *
 * Netlify may execute functions from a bundled runtime
 * location rather than directly from the repo root.
 *
 * We therefore test several legitimate locations.
 * =====================================================
 */

function getEvidencePathCandidates() {
  return [
    /*
     * Normal repo-root execution.
     */
    path.join(
      process.cwd(),
      "data",
      "sprouts-evidence.json"
    ),

    /*
     * Relative to:
     *
     * netlify/functions/lib/sprouts.js
     *
     * ../../../data/sprouts-evidence.json
     */
    path.resolve(
      __dirname,
      "../../../data/sprouts-evidence.json"
    ),

    /*
     * Some Netlify bundles preserve a function-level
     * directory adjacent to bundled support files.
     */
    path.resolve(
      __dirname,
      "../../data/sprouts-evidence.json"
    ),

    /*
     * Additional bundled-runtime fallback.
     */
    path.resolve(
      __dirname,
      "../data/sprouts-evidence.json"
    )
  ];
}


/*
 * =====================================================
 * FIND EVIDENCE FILE
 * =====================================================
 */

function findEvidencePath() {
  const candidates =
    getEvidencePathCandidates();


  for (
    const candidate of
    candidates
  ) {
    try {
      if (
        fs.existsSync(
          candidate
        )
      ) {
        return {
          found: true,
          path: candidate,
          candidates
        };
      }
    } catch (_) {
      /*
       * Ignore one bad filesystem lookup and
       * continue trying the other locations.
       */
    }
  }


  return {
    found: false,
    path: null,
    candidates
  };
}


/*
 * =====================================================
 * LOAD SPROUTS EVIDENCE
 * =====================================================
 */

function loadSproutsEvidence() {
  try {

    const lookup =
      findEvidencePath();


    if (
      !lookup.found ||
      !lookup.path
    ) {
      return {
        ok: false,

        records: [],

        evidencePath:
          null,

        attemptedPaths:
          lookup.candidates,

        error:
          "Sprouts evidence file was not found in any expected Netlify runtime location."
      };
    }


    const raw =
      fs.readFileSync(
        lookup.path,
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

        evidencePath:
          lookup.path,

        attemptedPaths:
          lookup.candidates,

        error:
          "Sprouts evidence file must contain a JSON array."
      };
    }


    return {
      ok: true,

      records:
        parsed,

      evidencePath:
        lookup.path,

      attemptedPaths:
        lookup.candidates,

      error:
        null
    };


  } catch (error) {

    return {
      ok: false,

      records: [],

      evidencePath:
        null,

      attemptedPaths:
        getEvidencePathCandidates(),

      error:
        error.message
    };
  }
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
   * Package size known
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
 *
 * Primary:
 * data/sprouts-evidence.json
 *
 * Fallback:
 * supplied prototype evidence from compare.js
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
   * ===================================================
   * PRIMARY EVIDENCE FILE
   * ===================================================
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
           * Retailer must be Sprouts.
           */

          if (
            String(
              evidence.retailer ||
              ""
            )
              .trim()
              .toLowerCase() !==
            "sprouts"
          ) {
            return false;
          }


          /*
           * Exact canonical product match.
           */

          if (
            canonicalId
          ) {
            return (
              String(
                evidence
                  .canonicalId ||
                ""
              ).trim() ===
              String(
                canonicalId
              ).trim()
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

        attemptedPaths:
          loaded.attemptedPaths,

        loadError:
          null
      };
    }


    /*
     * The file loaded successfully, but there was
     * no matching canonical product.
     */

    return {
      source:
        "sprouts-evidence-file-no-match",

      records:
        [],

      evidencePath:
        loaded.evidencePath,

      attemptedPaths:
        loaded.attemptedPaths,

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
      loaded.evidencePath ||
      null,

    attemptedPaths:
      loaded.attemptedPaths ||
      [],

    loadError:
      loaded.error ||
      null
  };
}


/*
 * =====================================================
 * NORMALIZE ONE SPROUTS EVIDENCE RECORD
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


  normalized.confidenceScore =
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
   * Preserve evidence metadata.
   */

  normalized.canonicalId =
    evidence
      .canonicalId ||
    null;


  normalized.observedAt =
    evidence
      .observedAt ||
    null;


  normalized.sourceType =
    evidence
      .sourceType ||
    "public-web-evidence";


  normalized.sourceUrl =
    evidence
      .sourceUrl ||
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
     * Reject incompatible units,
     * weak matches and weak evidence.
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

      sourceUrl:
        normalized
          .sourceUrl,

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
   * ===================================================
   * SORT
   *
   * 1. lowest actual purchase cost
   * 2. strongest product match
   * 3. strongest evidence confidence
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
   *
   * Include diagnostics so compare.js can expose
   * exactly where the evidence came from.
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
        retrieval
          .evidencePath ||
        null,

      attemptedPaths:
        retrieval
          .attemptedPaths ||
        [],

      recordCount:
        rawCandidates
          .length,

      acceptedCount:
        offers.length,

      loadError:
        retrieval
          .loadError ||
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

  getEvidencePathCandidates,

  findEvidencePath,

  loadSproutsEvidence,

  scoreConfidence,

  retrieveSproutsCandidates,

  normalizeSproutsEvidence,

  getSproutsOffers
};
