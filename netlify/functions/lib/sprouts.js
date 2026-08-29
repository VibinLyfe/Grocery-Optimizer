/*
 * sprouts.js
 *
 * Sprouts retailer adapter for Grocery Optimizer.
 *
 * This sits between Sprouts product evidence and
 * our shared normalization/optimization system.
 */

const {
  normalizeOffer,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./normalize");


/*
 * =====================================================
 * KNOXVILLE SPROUTS
 * =====================================================
 */

const SPROUTS_MARKET = {
  retailer: "Sprouts",

  city: "Knoxville",

  state: "TN",

  zip: "37922",

  address:
    "9622 Kingston Pike",

  market:
    "Knoxville, TN"
};


/*
 * =====================================================
 * SOURCE CONFIDENCE
 *
 * This measures how confident we are in the
 * retailer/price/location evidence.
 *
 * It does NOT measure whether the product itself
 * matches what the shopper requested.
 * =====================================================
 */

function scoreConfidence(
  evidence
) {
  let score = 0;


  if (
    evidence.retailer ===
    "Sprouts"
  ) {
    score += 20;
  }


  if (
    Number(
      evidence.price
    ) > 0
  ) {
    score += 20;
  }


  if (evidence.size) {
    score += 15;
  }


  if (
    evidence
      .locationConfirmed ===
    true
  ) {
    score += 20;
  }

  else if (
    evidence
      .marketConfirmed ===
    true
  ) {
    score += 10;
  }


  /*
   * Freshness.
   */

  if (
    evidence.observedAt
  ) {
    const observed =
      new Date(
        evidence.observedAt
      );


    const ageHours =
      (
        Date.now() -
        observed.getTime()
      ) /
      3600000;


    if (
      !Number.isNaN(
        ageHours
      )
    ) {
      if (
        ageHours <= 24
      ) {
        score += 20;
      }

      else if (
        ageHours <= 72
      ) {
        score += 15;
      }

      else if (
        ageHours <= 168
      ) {
        score += 10;
      }

      else if (
        ageHours <= 720
      ) {
        score += 5;
      }
    }
  }


  /*
   * Strong public retailer evidence.
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
      Math.round(score)
    )
  );
}


/*
 * =====================================================
 * SPROUTS RETRIEVAL INTERFACE
 * =====================================================
 *
 * For this stage, Sprouts evidence is supplied to
 * this adapter.
 *
 * We are deliberately keeping retrieval separate
 * from normalization.
 *
 * When we connect the free Sprouts retrieval layer,
 * it will feed results through this function.
 * =====================================================
 */

async function retrieveSproutsCandidates(
  request,
  suppliedEvidence = []
) {
  if (
    !Array.isArray(
      suppliedEvidence
    )
  ) {
    return [];
  }

  return suppliedEvidence;
}


/*
 * =====================================================
 * NORMALIZE ONE SPROUTS PRODUCT
 * =====================================================
 */

function normalizeSproutsEvidence(
  evidence
) {
  if (!evidence) {
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
          SPROUTS_MARKET.market,

        address:
          SPROUTS_MARKET.address,

        zip:
          SPROUTS_MARKET.zip,

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
          null
      }
    });


  if (!normalized) {
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
        evidence.observedAt,

      sourceType:
        evidence.sourceType
    });


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
  const rawCandidates =
    await retrieveSproutsCandidates(
      request,
      suppliedEvidence
    );


  const offers = [];


  for (
    const candidate of
    rawCandidates
  ) {
    const normalized =
      normalizeSproutsEvidence(
        candidate
      );


    if (!normalized) {
      continue;
    }


    /*
     * Is this actually the product
     * the shopper requested?
     */

    const matchScore =
      scoreProductMatch(
        request,
        normalized
      );


    /*
     * How many packages must the
     * shopper actually purchase?
     */

    const packagePlan =
      calculatePackageRequirement(
        request,
        normalized
      );


    /*
     * If units cannot legitimately
     * be reconciled, reject it.
     *
     * Example:
     *
     * Shopper asks for 1 lb.
     * Retailer only tells us "1 each."
     *
     * We do not invent a weight.
     */

    if (!packagePlan) {
      continue;
    }


    /*
     * Reject weak product matches.
     */

    if (
      matchScore < 60
    ) {
      continue;
    }


    /*
     * Reject extremely weak price
     * evidence.
     */

    if (
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

      matchScore,

      confidenceScore:
        normalized
          .confidenceScore,

      purchasePlan:
        packagePlan,

      totalCost:
        packagePlan.totalCost
    });
  }


  /*
   * Sort by real checkout cost.
   *
   * If tied:
   * better product match wins.
   *
   * If still tied:
   * stronger source confidence wins.
   */

  offers.sort(
    (a, b) => {
      if (
        a.totalCost !==
        b.totalCost
      ) {
        return (
          a.totalCost -
          b.totalCost
        );
      }


      if (
        a.matchScore !==
        b.matchScore
      ) {
        return (
          b.matchScore -
          a.matchScore
        );
      }


      return (
        b.confidenceScore -
        a.confidenceScore
      );
    }
  );


  return {
    retailer:
      "Sprouts",

    market:
      SPROUTS_MARKET,

    request,

    offers,

    winner:
      offers[0] ||
      null
  };
}


module.exports = {
  SPROUTS_MARKET,
  scoreConfidence,
  retrieveSproutsCandidates,
  normalizeSproutsEvidence,
  getSproutsOffers
};
