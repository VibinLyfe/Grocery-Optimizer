/*
 * netlify/functions/evidence-merge.js
 *
 * Accepts newly discovered public evidence for either
 * Earth Fare or Sprouts and returns a complete,
 * validated replacement evidence array.
 *
 * IMPORTANT:
 * This function does NOT write to GitHub or modify
 * repository files.
 *
 * It only returns the merged JSON so the evidence file
 * can be safely reviewed and replaced.
 */

const {
  processEarthFareDiscovery,
  summarizeEarthFareRefresh
} = require("./lib/earthfare-refresh");

const {
  processSproutsDiscovery,
  summarizeSproutsRefresh
} = require("./lib/sprouts-refresh");


/*
 * =====================================================
 * LOAD CURRENT EVIDENCE
 * =====================================================
 */

let EARTH_FARE_EVIDENCE = [];
let SPROUTS_EVIDENCE = [];

let EARTH_FARE_LOAD_ERROR = null;
let SPROUTS_LOAD_ERROR = null;


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
      "earthfare-evidence.json is not an array.";
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
      "sprouts-evidence.json is not an array.";
  }

} catch (error) {
  SPROUTS_LOAD_ERROR =
    error.message;
}


/*
 * =====================================================
 * RESPONSE
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
        "no-store",

      "access-control-allow-origin":
        "*",

      "access-control-allow-methods":
        "POST, OPTIONS",

      "access-control-allow-headers":
        "content-type"
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
 * RETAILER NORMALIZATION
 * =====================================================
 */

function normalizeRetailer(
  value
) {
  const retailer =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    retailer ===
      "earth fare" ||
    retailer ===
      "earthfare" ||
    retailer ===
      "earth-fare"
  ) {
    return "earthFare";
  }

  if (
    retailer ===
      "sprouts" ||
    retailer ===
      "sprouts farmers market"
  ) {
    return "sprouts";
  }

  return null;
}


/*
 * =====================================================
 * PARSE BODY
 * =====================================================
 */

function parseBody(
  event
) {
  if (!event?.body) {
    return null;
  }

  try {
    return JSON.parse(
      event.body
    );
  } catch (error) {
    return null;
  }
}


/*
 * =====================================================
 * FORMAT REJECTED RECORDS
 * =====================================================
 */

function formatRejected(
  records
) {
  return (
    Array.isArray(records)
      ? records
      : []
  ).map(
    record => ({
      title:
        record.title ||
        null,

      sourceUrl:
        record.sourceUrl ||
        null,

      reason:
        record.reason ||
        null,

      qualityScore:
        Number(
          record.qualityScore ||
          0
        )
    })
  );
}


/*
 * =====================================================
 * HANDLER
 * =====================================================
 */

exports.handler =
  async function (
    event
  ) {

    /*
     * CORS preflight
     */

    if (
      event.httpMethod ===
      "OPTIONS"
    ) {
      return {
        statusCode: 204,

        headers: {
          "access-control-allow-origin":
            "*",

          "access-control-allow-methods":
            "POST, OPTIONS",

          "access-control-allow-headers":
            "content-type"
        },

        body: ""
      };
    }


    /*
     * Only allow POST.
     */

    if (
      event.httpMethod !==
      "POST"
    ) {
      return json(
        405,
        {
          ok: false,

          message:
            "Use POST for evidence merging."
        }
      );
    }


    try {
      const body =
        parseBody(
          event
        );

      if (!body) {
        return json(
          400,
          {
            ok: false,

            message:
              "Request body must contain valid JSON."
          }
        );
      }


      const retailer =
        normalizeRetailer(
          body.retailer
        );


      if (!retailer) {
        return json(
          400,
          {
            ok: false,

            message:
              "Retailer must be Earth Fare or Sprouts."
          }
        );
      }


      const discoveredRecords =
        Array.isArray(
          body.records
        )
          ? body.records
          : [];


      if (
        !discoveredRecords.length
      ) {
        return json(
          400,
          {
            ok: false,

            message:
              "At least one discovered evidence record is required."
          }
        );
      }


      /*
       * =================================================
       * EARTH FARE
       * =================================================
       */

      if (
        retailer ===
        "earthFare"
      ) {

        if (
          EARTH_FARE_LOAD_ERROR
        ) {
          return json(
            500,
            {
              ok: false,

              retailer:
                "Earth Fare",

              message:
                "Current Earth Fare evidence could not be loaded.",

              details:
                EARTH_FARE_LOAD_ERROR
            }
          );
        }


        const result =
          processEarthFareDiscovery({
            existingRecords:
              EARTH_FARE_EVIDENCE,

            discoveredRecords
          });


        return json(
          200,
          {
            ok: true,

            retailer:
              "Earth Fare",

            generatedAt:
              new Date()
                .toISOString(),

            summary:
              summarizeEarthFareRefresh(
                result
              ),

            accepted:
              result.acceptedNew ||
              [],

            rejected:
              formatRejected(
                result.rejectedNew
              ),

            /*
             * This is the COMPLETE replacement
             * earthfare-evidence.json content.
             */

            evidence:
              result.records ||
              []
          }
        );
      }


      /*
       * =================================================
       * SPROUTS
       * =================================================
       */

      if (
        retailer ===
        "sprouts"
      ) {

        if (
          SPROUTS_LOAD_ERROR
        ) {
          return json(
            500,
            {
              ok: false,

              retailer:
                "Sprouts",

              message:
                "Current Sprouts evidence could not be loaded.",

              details:
                SPROUTS_LOAD_ERROR
            }
          );
        }


        const result =
          processSproutsDiscovery({
            existingRecords:
              SPROUTS_EVIDENCE,

            discoveredRecords
          });


        return json(
          200,
          {
            ok: true,

            retailer:
              "Sprouts",

            generatedAt:
              new Date()
                .toISOString(),

            summary:
              summarizeSproutsRefresh(
                result
              ),

            accepted:
              result.acceptedNew ||
              [],

            rejected:
              formatRejected(
                result.rejectedNew
              ),

            /*
             * This is the COMPLETE replacement
             * sprouts-evidence.json content.
             */

            evidence:
              result.records ||
              []
          }
        );
      }


      return json(
        400,
        {
          ok: false,

          message:
            "Unsupported retailer."
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
