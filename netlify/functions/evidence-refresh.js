/*
 * netlify/functions/evidence-refresh.js
 *
 * Produces a refresh/discovery plan for Earth Fare
 * and Sprouts.
 *
 * This function does NOT perform web searches and
 * does NOT scrape retailer websites.
 *
 * It reads:
 *   - public/products.json
 *   - data/earthfare-evidence.json
 *   - data/sprouts-evidence.json
 *
 * Then it reports which products are:
 *   - missing evidence
 *   - aging
 *   - stale
 *   - unknown
 *
 * It also generates suggested discovery queries
 * for the refresh workflow.
 */

const {
  buildEarthFareDiscoveryPlan,
  EARTH_FARE_REFRESH_MARKET
} = require("./lib/earthfare-refresh");

const {
  buildSproutsDiscoveryPlan,
  SPROUTS_REFRESH_MARKET
} = require("./lib/sprouts-refresh");


/*
 * =====================================================
 * LOAD FILES
 * =====================================================
 */

let PRODUCTS = [];
let EARTH_FARE_EVIDENCE = [];
let SPROUTS_EVIDENCE = [];

let PRODUCT_LOAD_ERROR = null;
let EARTH_FARE_LOAD_ERROR = null;
let SPROUTS_LOAD_ERROR = null;


try {
  const loaded =
    require("../../public/products.json");

  if (
    Array.isArray(loaded)
  ) {
    PRODUCTS = loaded;

  } else {
    PRODUCT_LOAD_ERROR =
      "products.json loaded, but it is not a JSON array.";
  }

} catch (error) {
  PRODUCT_LOAD_ERROR =
    error.message;
}


try {
  const loaded =
    require("../../data/earthfare-evidence.json");

  if (
    Array.isArray(loaded)
  ) {
    EARTH_FARE_EVIDENCE =
      loaded;

  } else {
    EARTH_FARE_LOAD_ERROR =
      "earthfare-evidence.json loaded, but it is not a JSON array.";
  }

} catch (error) {
  EARTH_FARE_LOAD_ERROR =
    error.message;
}


try {
  const loaded =
    require("../../data/sprouts-evidence.json");

  if (
    Array.isArray(loaded)
  ) {
    SPROUTS_EVIDENCE =
      loaded;

  } else {
    SPROUTS_LOAD_ERROR =
      "sprouts-evidence.json loaded, but it is not a JSON array.";
  }

} catch (error) {
  SPROUTS_LOAD_ERROR =
    error.message;
}


/*
 * =====================================================
 * RESPONSE HELPER
 * =====================================================
 */

function json(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "content-type":
        "application/json; charset=utf-8",

      "cache-control":
        "no-store"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}


/*
 * =====================================================
 * TARGET SUMMARY
 * =====================================================
 */

function summarizePlan(
  plan
) {
  const safePlan =
    Array.isArray(plan)
      ? plan
      : [];

  const summary = {
    totalTargets:
      safePlan.length,

    missing:
      0,

    aging:
      0,

    stale:
      0,

    unknown:
      0
  };


  for (
    const target of
    safePlan
  ) {
    const reason =
      String(
        target?.reason ||
        ""
      );

    if (
      reason ===
      "missing-evidence"
    ) {
      summary.missing +=
        1;

    } else if (
      reason ===
      "aging-evidence"
    ) {
      summary.aging +=
        1;

    } else if (
      reason ===
      "stale-evidence"
    ) {
      summary.stale +=
        1;

    } else if (
      reason ===
      "unknown-evidence"
    ) {
      summary.unknown +=
        1;
    }
  }


  return summary;
}


/*
 * =====================================================
 * NORMALIZE TARGET FOR OUTPUT
 * =====================================================
 */

function formatTarget(
  target
) {
  const product =
    target?.product ||
    {};

  return {
    id:
      product.id ||
      null,

    label:
      product.label ||
      null,

    category:
      product.category ||
      null,

    queryName:
      product.queryName ||
      null,

    defaultUnit:
      product.defaultUnit ||
      null,

    reason:
      target?.reason ||
      null,

    freshness:
      target?.freshness ||
      null,

    queries:
      Array.isArray(
        target?.queries
      )
        ? target.queries
        : []
  };
}


/*
 * =====================================================
 * HANDLER
 * =====================================================
 */

exports.handler =
  async function () {
    try {

      /*
       * Fail clearly if the main product catalog
       * could not be loaded.
       */

      if (
        PRODUCT_LOAD_ERROR
      ) {
        return json(
          500,
          {
            ok: false,

            error:
              "Product catalog could not be loaded.",

            details:
              PRODUCT_LOAD_ERROR
          }
        );
      }


      /*
       * =================================================
       * EARTH FARE
       * =================================================
       */

      let earthFarePlan = [];

      if (
        !EARTH_FARE_LOAD_ERROR
      ) {
        earthFarePlan =
          buildEarthFareDiscoveryPlan({
            products:
              PRODUCTS,

            evidenceRecords:
              EARTH_FARE_EVIDENCE
          });
      }


      /*
       * =================================================
       * SPROUTS
       * =================================================
       */

      let sproutsPlan = [];

      if (
        !SPROUTS_LOAD_ERROR
      ) {
        sproutsPlan =
          buildSproutsDiscoveryPlan({
            products:
              PRODUCTS,

            evidenceRecords:
              SPROUTS_EVIDENCE
          });
      }


      /*
       * =================================================
       * RESPONSE
       * =================================================
       */

      return json(
        200,
        {
          ok: true,

          generatedAt:
            new Date()
              .toISOString(),

          catalog: {
            productCount:
              PRODUCTS.length
          },


          retailers: {

            earthFare: {
              retailer:
                "Earth Fare",

              location:
                EARTH_FARE_REFRESH_MARKET,

              evidenceRecordCount:
                EARTH_FARE_EVIDENCE
                  .length,

              loadError:
                EARTH_FARE_LOAD_ERROR,

              summary:
                summarizePlan(
                  earthFarePlan
                ),

              targets:
                earthFarePlan.map(
                  formatTarget
                )
            },


            sprouts: {
              retailer:
                "Sprouts",

              location:
                SPROUTS_REFRESH_MARKET,

              evidenceRecordCount:
                SPROUTS_EVIDENCE
                  .length,

              loadError:
                SPROUTS_LOAD_ERROR,

              summary:
                summarizePlan(
                  sproutsPlan
                ),

              targets:
                sproutsPlan.map(
                  formatTarget
                )
            }

          }
        }
      );

    } catch (
      error
    ) {
      return json(
        500,
        {
          ok: false,

          error:
            error.message
        }
      );
    }
  };
