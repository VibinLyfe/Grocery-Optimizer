const STORAGE_KEY = "toomey-grocery-weekly-list-v1";
const STOP_PENALTY = 5;


/*
 * =====================================================
 * PRODUCT CATALOG
 *
 * Front-end only.
 * These map the friendly dropdown selections to the
 * request language the existing backend already accepts.
 * =====================================================
 */

const PRODUCTS = {
  "ground-beef-organic-grassfed-85-15": {
    label:
      "Organic grass-fed 85/15 ground beef",

    queryName:
      "organic grass-fed 85/15 ground beef",

    defaultUnit:
      "lb",

    allowedUnits: [
      "lb",
      "oz"
    ]
  },

  "organic-broccoli": {
    label:
      "Organic broccoli",

    queryName:
      "organic broccoli",

    defaultUnit:
      "each",

    allowedUnits: [
      "each"
    ]
  },

  "organic-cucumber": {
    label:
      "Organic cucumber",

    queryName:
      "organic cucumber",

    defaultUnit:
      "each",

    allowedUnits: [
      "each"
    ]
  },

  "organic-baby-carrots": {
    label:
      "Organic baby carrots",

    queryName:
      "organic baby carrots",

    defaultUnit:
      "package",

    allowedUnits: [
      "package",
      "oz",
      "lb"
    ],

    /*
     * For the current prototype, one package of
     * organic baby carrots is treated as 16 oz
     * when talking to the existing backend.
     */
    packageEquivalent: {
      quantity: 16,
      unit: "oz"
    }
  },

  "organic-mango": {
    label:
      "Organic mango",

    queryName:
      "organic mango",

    defaultUnit:
      "each",

    allowedUnits: [
      "each"
    ]
  }
};


const UNIT_LABELS = {
  each:
    "each",

  package:
    "package",

  lb:
    "lb",

  oz:
    "oz",

  g:
    "g",

  kg:
    "kg",

  "fl oz":
    "fl oz",

  pint:
    "pint",

  quart:
    "quart",

  gallon:
    "gallon",

  ml:
    "ml",

  liter:
    "liter"
};


const COUNT_QUANTITIES = [
  1,
  2,
  3,
  4,
  5,
  6,
  8,
  10,
  12
];


const MEASURE_QUANTITIES = [
  0.5,
  1,
  1.5,
  2,
  2.5,
  3,
  4,
  5,
  6,
  8,
  10,
  12
];


/*
 * =====================================================
 * ELEMENTS
 * =====================================================
 */

const groceryListEl =
  document.querySelector(
    "#groceryList"
  );

const groceryItemTemplate =
  document.querySelector(
    "#groceryItemTemplate"
  );

const productSelect =
  document.querySelector(
    "#productSelect"
  );

const quantitySelect =
  document.querySelector(
    "#quantitySelect"
  );

const unitSelect =
  document.querySelector(
    "#unitSelect"
  );

const addItemButton =
  document.querySelector(
    "#addItemButton"
  );

const resetListButton =
  document.querySelector(
    "#resetListButton"
  );

const compareButton =
  document.querySelector(
    "#compareButton"
  );

const remainingItemCount =
  document.querySelector(
    "#remainingItemCount"
  );

const statusSection =
  document.querySelector(
    "#statusSection"
  );

const statusEl =
  document.querySelector(
    "#status"
  );

const resultsSection =
  document.querySelector(
    "#resultsSection"
  );

const resultsEl =
  document.querySelector(
    "#results"
  );

const optimizationCardTemplate =
  document.querySelector(
    "#optimizationCardTemplate"
  );


/*
 * =====================================================
 * STATE
 * =====================================================
 */

let groceryList =
  loadList();


/*
 * =====================================================
 * STORAGE
 * =====================================================
 */

function loadList() {
  try {
    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!saved) {
      return [];
    }

    const parsed =
      JSON.parse(saved);

    if (
      !Array.isArray(parsed)
    ) {
      return [];
    }

    return parsed.filter(
      item =>
        item &&
        PRODUCTS[
          item.productId
        ]
    );

  } catch (
    error
  ) {
    return [];
  }
}


function saveList() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      groceryList
    )
  );
}


/*
 * =====================================================
 * UTILITIES
 * =====================================================
 */

function makeId() {
  return [
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2, 9)
  ].join("-");
}


function money(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "—";
  }

  return new Intl
    .NumberFormat(
      "en-US",
      {
        style:
          "currency",

        currency:
          "USD"
      }
    )
    .format(number);
}


function quantityText(
  quantity
) {
  const number =
    Number(quantity);

  if (
    !Number.isFinite(number)
  ) {
    return "";
  }

  return Number.isInteger(
    number
  )
    ? String(number)
    : String(number);
}


function setStatus(
  message,
  type = "info"
) {
  statusSection.hidden =
    false;

  statusEl.textContent =
    message;

  statusEl.dataset.type =
    type;
}


function clearStatus() {
  statusSection.hidden =
    true;

  statusEl.textContent =
    "";

  delete statusEl.dataset.type;
}


function clearResults() {
  resultsSection.hidden =
    true;

  resultsEl.innerHTML =
    "";
}


/*
 * =====================================================
 * PRODUCT / UNIT DROPDOWNS
 * =====================================================
 */

function rebuildUnitOptions(
  productId
) {
  const product =
    PRODUCTS[
      productId
    ];

  unitSelect.innerHTML =
    "";

  if (!product) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      "each";

    option.textContent =
      "each";

    unitSelect.appendChild(
      option
    );

    rebuildQuantityOptions(
      "each"
    );

    return;
  }

  for (
    const unit of
    product.allowedUnits
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      unit;

    option.textContent =
      UNIT_LABELS[unit] ||
      unit;

    if (
      unit ===
      product.defaultUnit
    ) {
      option.selected =
        true;
    }

    unitSelect.appendChild(
      option
    );
  }

  rebuildQuantityOptions(
    product.defaultUnit
  );
}


function rebuildQuantityOptions(
  unit
) {
  const currentValue =
    Number(
      quantitySelect.value
    );

  const quantities =
    (
      unit === "each" ||
      unit === "package"
    )
      ? COUNT_QUANTITIES
      : MEASURE_QUANTITIES;

  quantitySelect.innerHTML =
    "";

  for (
    const quantity of
    quantities
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(quantity);

    option.textContent =
      String(quantity);

    quantitySelect.appendChild(
      option
    );
  }

  if (
    quantities.includes(
      currentValue
    )
  ) {
    quantitySelect.value =
      String(
        currentValue
      );

  } else {
    quantitySelect.value =
      "1";
  }
}


/*
 * =====================================================
 * WEEKLY LIST RENDERING
 * =====================================================
 */

function renderList() {
  groceryListEl.innerHTML =
    "";

  if (
    !groceryList.length
  ) {
    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "empty-list";

    empty.innerHTML = `
      <strong>Your weekly list is empty.</strong>
      <span>Add your regular groceries below.</span>
    `;

    groceryListEl.appendChild(
      empty
    );

    updateRemainingCount();

    return;
  }

  for (
    const item of
    groceryList
  ) {
    const product =
      PRODUCTS[
        item.productId
      ];

    if (!product) {
      continue;
    }

    const fragment =
      groceryItemTemplate
        .content
        .cloneNode(true);

    const article =
      fragment.querySelector(
        ".grocery-item"
      );

    const checkbox =
      fragment.querySelector(
        ".grocery-check"
      );

    const productEl =
      fragment.querySelector(
        ".grocery-item-product"
      );

    const metaEl =
      fragment.querySelector(
        ".grocery-item-meta"
      );

    const removeButton =
      fragment.querySelector(
        ".grocery-remove"
      );

    checkbox.checked =
      Boolean(
        item.completed
      );

    productEl.textContent =
      product.label;

    metaEl.textContent =
      `${quantityText(
        item.quantity
      )} ${UNIT_LABELS[
        item.unit
      ] || item.unit}`;

    article.dataset.itemId =
      item.id;

    if (
      item.completed
    ) {
      article.classList.add(
        "is-complete"
      );
    }

    checkbox.addEventListener(
      "change",
      () => {
        item.completed =
          checkbox.checked;

        saveList();
        renderList();
      }
    );

    removeButton.addEventListener(
      "click",
      () => {
        groceryList =
          groceryList.filter(
            grocery =>
              grocery.id !==
              item.id
          );

        saveList();
        renderList();
        clearResults();
      }
    );

    groceryListEl.appendChild(
      fragment
    );
  }

  updateRemainingCount();
}


function updateRemainingCount() {
  const remaining =
    groceryList.filter(
      item =>
        !item.completed
    ).length;

  remainingItemCount.textContent =
    remaining === 1
      ? "1 item to compare"
      : `${remaining} items to compare`;

  compareButton.disabled =
    remaining === 0;
}


/*
 * =====================================================
 * ADD / RESET
 * =====================================================
 */

function addItem() {
  const productId =
    productSelect.value;

  const quantity =
    Number(
      quantitySelect.value
    );

  const unit =
    unitSelect.value;

  const product =
    PRODUCTS[
      productId
    ];

  if (!product) {
    setStatus(
      "Choose a product first.",
      "error"
    );

    return;
  }

  if (
    !Number.isFinite(
      quantity
    ) ||
    quantity <= 0
  ) {
    setStatus(
      "Choose a valid quantity.",
      "error"
    );

    return;
  }

  if (
    !product.allowedUnits
      .includes(unit)
  ) {
    setStatus(
      "That unit is not available for this product.",
      "error"
    );

    return;
  }

  /*
   * If the exact same product + unit already exists,
   * increase the quantity instead of creating a duplicate.
   */

  const existing =
    groceryList.find(
      item =>
        item.productId ===
          productId &&
        item.unit ===
          unit
    );

  if (existing) {
    existing.quantity =
      Number(
        existing.quantity
      ) +
      quantity;

    existing.completed =
      false;

  } else {
    groceryList.push({
      id:
        makeId(),

      productId,

      quantity,

      unit,

      completed:
        false
    });
  }

  saveList();
  renderList();
  clearResults();
  clearStatus();

  productSelect.value =
    "";

  rebuildUnitOptions(
    ""
  );

  quantitySelect.value =
    "1";
}


function resetWeeklyList() {
  if (
    !groceryList.length
  ) {
    return;
  }

  groceryList =
    groceryList.map(
      item => ({
        ...item,
        completed:
          false
      })
    );

  saveList();
  renderList();
  clearResults();

  setStatus(
    "Weekly list reset. Everything is ready to shop again.",
    "success"
  );
}


/*
 * =====================================================
 * BACKEND QUERY BUILDER
 * =====================================================
 */

function buildBackendQuery(
  item
) {
  const product =
    PRODUCTS[
      item.productId
    ];

  if (!product) {
    return null;
  }

  let quantity =
    Number(
      item.quantity
    );

  let unit =
    item.unit;

  /*
   * The current backend does not need to understand
   * the word "package" directly.
   *
   * For products where we know the standard package
   * equivalent, the front end quietly translates it.
   */

  if (
    unit === "package" &&
    product.packageEquivalent
  ) {
    quantity =
      quantity *
      product
        .packageEquivalent
        .quantity;

    unit =
      product
        .packageEquivalent
        .unit;
  }

  return [
    quantity,
    unit,
    product.queryName
  ]
    .filter(Boolean)
    .join(" ");
}


/*
 * =====================================================
 * API
 * =====================================================
 */

async function compareItem(
  item
) {
  const query =
    buildBackendQuery(
      item
    );

  if (!query) {
    throw new Error(
      "Could not build the product request."
    );
  }

  const response =
    await fetch(
      `/api/compare?q=${encodeURIComponent(
        query
      )}`
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Price comparison failed with status ${response.status}.`
    );
  }

  const data =
    await response.json();

  if (
    !data.ok
  ) {
    throw new Error(
      data.message ||
      data.error ||
      "No comparison was available."
    );
  }

  return {
    item,
    query,
    response:
      data
  };
}


/*
 * =====================================================
 * OFFER NORMALIZATION
 * =====================================================
 */

function buildItemOffers(
  comparison
) {
  const product =
    PRODUCTS[
      comparison.item
        .productId
    ];

  const results =
    Array.isArray(
      comparison
        .response
        .results
    )
      ? comparison
          .response
          .results
      : [];

  return results
    .map(
      result => ({
        itemId:
          comparison.item.id,

        productId:
          comparison.item
            .productId,

        productLabel:
          product.label,

        requestedQuantity:
          comparison.item
            .quantity,

        requestedUnit:
          comparison.item
            .unit,

        retailer:
          result.retailer,

        cost:
          Number(
            result.estimatedCost
          ),

        dataMode:
          result.dataMode,

        freshness:
          result.freshness,

        ageDays:
          result.ageDays,

        needsRefresh:
          result.needsRefresh,

        packages:
          Array.isArray(
            result.packages
          )
            ? result.packages
            : [],

        rawResult:
          result
      })
    )
    .filter(
      offer =>
        offer.retailer &&
        Number.isFinite(
          offer.cost
        )
    );
}


/*
 * =====================================================
 * LOWEST COST PLAN
 * =====================================================
 */

function buildLowestCostPlan(
  itemsWithOffers
) {
  const selections =
    [];

  const unavailable =
    [];

  for (
    const entry of
    itemsWithOffers
  ) {
    const offers =
      [...entry.offers]
        .sort(
          (a, b) =>
            a.cost -
            b.cost
        );

    if (
      !offers.length
    ) {
      unavailable.push(
        entry.item
      );

      continue;
    }

    selections.push(
      offers[0]
    );
  }

  return buildPlan({
    key:
      "lowest",

    label:
      "LOWEST COST",

    title:
      "Cheapest overall",

    selections,

    unavailable
  });
}


/*
 * =====================================================
 * BEST BALANCE PLAN
 *
 * Because we currently compare only four retailers,
 * we can safely evaluate every possible retailer
 * combination.
 *
 * The displayed total is always the real grocery cost.
 * The $5/store value is used only to decide which
 * combination provides the best convenience/cost balance.
 * =====================================================
 */

function getAllStoreSubsets(
  retailers
) {
  const subsets =
    [];

  const count =
    retailers.length;

  for (
    let mask = 1;
    mask <
      (1 << count);
    mask += 1
  ) {
    const subset =
      [];

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      if (
        mask &
        (1 << index)
      ) {
        subset.push(
          retailers[index]
        );
      }
    }

    subsets.push(
      subset
    );
  }

  return subsets;
}


function buildBestBalancePlan(
  itemsWithOffers
) {
  const retailers =
    [
      ...new Set(
        itemsWithOffers.flatMap(
          entry =>
            entry.offers.map(
              offer =>
                offer.retailer
            )
        )
      )
    ];

  const subsets =
    getAllStoreSubsets(
      retailers
    );

  let best =
    null;

  for (
    const subset of
    subsets
  ) {
    const selections =
      [];

    const unavailable =
      [];

    for (
      const entry of
      itemsWithOffers
    ) {
      const eligible =
        entry.offers
          .filter(
            offer =>
              subset.includes(
                offer.retailer
              )
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          );

      if (
        !eligible.length
      ) {
        unavailable.push(
          entry.item
        );

        continue;
      }

      selections.push(
        eligible[0]
      );
    }

    /*
     * Best Balance should cover the complete list
     * whenever possible.
     */

    if (
      unavailable.length
    ) {
      continue;
    }

    const actualStores =
      [
        ...new Set(
          selections.map(
            selection =>
              selection.retailer
          )
        )
      ];

    const actualTotal =
      selections.reduce(
        (
          sum,
          selection
        ) =>
          sum +
          selection.cost,
        0
      );

    const conveniencePenalty =
      Math.max(
        0,
        actualStores.length - 1
      ) *
      STOP_PENALTY;

    const score =
      actualTotal +
      conveniencePenalty;

    const candidate = {
      selections,
      unavailable,
      actualTotal,
      storeCount:
        actualStores.length,
      score
    };

    if (
      !best ||
      candidate.score <
        best.score ||
      (
        candidate.score ===
          best.score &&
        candidate.actualTotal <
          best.actualTotal
      )
    ) {
      best =
        candidate;
    }
  }

  if (!best) {
    return buildLowestCostPlan(
      itemsWithOffers
    );
  }

  return buildPlan({
    key:
      "balance",

    label:
      "BEST BALANCE",

    title:
      "Low cost + fewer stops",

    selections:
      best.selections,

    unavailable:
      best.unavailable
  });
}


/*
 * =====================================================
 * ONE STORE PLAN
 * =====================================================
 */

function buildOneStorePlan(
  itemsWithOffers
) {
  const retailers =
    [
      ...new Set(
        itemsWithOffers.flatMap(
          entry =>
            entry.offers.map(
              offer =>
                offer.retailer
            )
        )
      )
    ];

  let best =
    null;

  for (
    const retailer of
    retailers
  ) {
    const selections =
      [];

    const unavailable =
      [];

    for (
      const entry of
      itemsWithOffers
    ) {
      const offer =
        entry.offers
          .filter(
            candidate =>
              candidate.retailer ===
              retailer
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          )[0];

      if (offer) {
        selections.push(
          offer
        );

      } else {
        unavailable.push(
          entry.item
        );
      }
    }

    const cost =
      selections.reduce(
        (
          sum,
          selection
        ) =>
          sum +
          selection.cost,
        0
      );

    const candidate = {
      retailer,
      selections,
      unavailable,
      coverage:
        selections.length,
      cost
    };

    if (
      !best ||
      candidate.coverage >
        best.coverage ||
      (
        candidate.coverage ===
          best.coverage &&
        candidate.cost <
          best.cost
      )
    ) {
      best =
        candidate;
    }
  }

  if (!best) {
    return buildPlan({
      key:
        "one-store",

      label:
        "ONE STORE",

      title:
        "No single-store option",

      selections:
        [],

      unavailable:
        itemsWithOffers.map(
          entry =>
            entry.item
        )
    });
  }

  return buildPlan({
    key:
      "one-store",

    label:
      "ONE STORE",

    title:
      best.unavailable.length
        ? `${best.retailer} covers the most`
        : `${best.retailer} only`,

    selections:
      best.selections,

    unavailable:
      best.unavailable
  });
}


/*
 * =====================================================
 * PLAN SHAPE
 * =====================================================
 */

function buildPlan({
  key,
  label,
  title,
  selections,
  unavailable
}) {
  const total =
    selections.reduce(
      (
        sum,
        selection
      ) =>
        sum +
        selection.cost,
      0
    );

  const stores =
    {};

  for (
    const selection of
    selections
  ) {
    if (
      !stores[
        selection.retailer
      ]
    ) {
      stores[
        selection.retailer
      ] = {
        retailer:
          selection.retailer,

        total:
          0,

        items:
          []
      };
    }

    stores[
      selection.retailer
    ].total +=
      selection.cost;

    stores[
      selection.retailer
    ].items.push(
      selection
    );
  }

  return {
    key,
    label,
    title,

    total,

    storeCount:
      Object.keys(
        stores
      ).length,

    selections,

    unavailable,

    stores:
      Object.values(
        stores
      ).sort(
        (a, b) =>
          a.retailer.localeCompare(
            b.retailer
          )
      )
  };
}


/*
 * =====================================================
 * FRESHNESS DISPLAY
 * =====================================================
 */

function freshnessText(
  offer
) {
  if (
    offer.dataMode ===
    "live"
  ) {
    return "Live price";
  }

  if (
    offer.freshness ===
    "stale"
  ) {
    return "Price may be outdated";
  }

  if (
    offer.freshness ===
    "aging"
  ) {
    if (
      offer.ageDays === 1
    ) {
      return "Updated 1 day ago";
    }

    if (
      Number.isFinite(
        Number(
          offer.ageDays
        )
      )
    ) {
      return `Updated ${offer.ageDays} days ago`;
    }

    return "Recently updated";
  }

  if (
    offer.freshness ===
    "current"
  ) {
    if (
      offer.ageDays === 0
    ) {
      return "Updated today";
    }

    if (
      offer.ageDays === 1
    ) {
      return "Updated 1 day ago";
    }

    if (
      Number.isFinite(
        Number(
          offer.ageDays
        )
      )
    ) {
      return `Updated ${offer.ageDays} days ago`;
    }

    return "Recently updated";
  }

  return "";
}


/*
 * =====================================================
 * RESULT RENDERING
 * =====================================================
 */

function renderPlan(
  plan
) {
  const fragment =
    optimizationCardTemplate
      .content
      .cloneNode(true);

  const card =
    fragment.querySelector(
      ".optimization-card"
    );

  const label =
    fragment.querySelector(
      ".optimization-label"
    );

  const title =
    fragment.querySelector(
      ".optimization-title"
    );

  const total =
    fragment.querySelector(
      ".optimization-total"
    );

  const meta =
    fragment.querySelector(
      ".optimization-meta"
    );

  const storesEl =
    fragment.querySelector(
      ".optimization-stores"
    );

  card.dataset.plan =
    plan.key;

  label.textContent =
    plan.label;

  title.textContent =
    plan.title;

  total.textContent =
    money(
      plan.total
    );

  const storeWord =
    plan.storeCount === 1
      ? "store"
      : "stores";

  meta.textContent =
    `${plan.storeCount} ${storeWord} · ${plan.selections.length} items priced`;

  for (
    const store of
    plan.stores
  ) {
    const storeBlock =
      document.createElement(
        "section"
      );

    storeBlock.className =
      "store-plan";

    const storeHeader =
      document.createElement(
        "div"
      );

    storeHeader.className =
      "store-plan-header";

    const storeName =
      document.createElement(
        "strong"
      );

    storeName.textContent =
      store.retailer;

    const storeTotal =
      document.createElement(
        "span"
      );

    storeTotal.textContent =
      money(
        store.total
      );

    storeHeader.append(
      storeName,
      storeTotal
    );

    storeBlock.appendChild(
      storeHeader
    );


    const itemList =
      document.createElement(
        "div"
      );

    itemList.className =
      "store-item-list";


    for (
      const offer of
      store.items
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "store-item";


      const main =
        document.createElement(
          "div"
        );

      main.className =
        "store-item-main";


      const product =
        document.createElement(
          "strong"
        );

      product.textContent =
        offer.productLabel;


      const details =
        document.createElement(
          "span"
        );

      details.className =
        "store-item-details";

      const freshness =
        freshnessText(
          offer
        );

      details.textContent =
        [
          `${quantityText(
            offer.requestedQuantity
          )} ${
            UNIT_LABELS[
              offer.requestedUnit
            ] ||
            offer.requestedUnit
          }`,
          freshness
        ]
          .filter(Boolean)
          .join(" · ");


      const price =
        document.createElement(
          "span"
        );

      price.className =
        "store-item-price";

      price.textContent =
        money(
          offer.cost
        );


      main.append(
        product,
        details
      );

      row.append(
        main,
        price
      );

      itemList.appendChild(
        row
      );
    }


    storeBlock.appendChild(
      itemList
    );

    storesEl.appendChild(
      storeBlock
    );
  }


  if (
    plan.unavailable.length
  ) {
    const unavailable =
      document.createElement(
        "div"
      );

    unavailable.className =
      "unavailable-items";

    const heading =
      document.createElement(
        "strong"
      );

    heading.textContent =
      "Not available in this plan";


    const names =
      document.createElement(
        "span"
      );

    names.textContent =
      plan.unavailable
        .map(
          item =>
            PRODUCTS[
              item.productId
            ]?.label ||
            "Unknown item"
        )
        .join(", ");


    unavailable.append(
      heading,
      names
    );

    storesEl.appendChild(
      unavailable
    );
  }


  resultsEl.appendChild(
    fragment
  );
}


/*
 * =====================================================
 * COMPARE FULL WEEKLY LIST
 * =====================================================
 */

async function compareWeeklyList() {
  const activeItems =
    groceryList.filter(
      item =>
        !item.completed
    );

  if (
    !activeItems.length
  ) {
    setStatus(
      "Everything on your weekly list is already checked off.",
      "info"
    );

    return;
  }

  clearResults();

  compareButton.disabled =
    true;

  addItemButton.disabled =
    true;

  setStatus(
    `Comparing ${activeItems.length} ${
      activeItems.length === 1
        ? "item"
        : "items"
    } across available stores...`,
    "loading"
  );

  try {
    /*
     * Run the item comparisons in parallel.
     */

    const settled =
      await Promise.allSettled(
        activeItems.map(
          compareItem
        )
      );


    const comparisons =
      [];

    const failedItems =
      [];


    settled.forEach(
      (
        result,
        index
      ) => {
        if (
          result.status ===
          "fulfilled"
        ) {
          comparisons.push(
            result.value
          );

        } else {
          failedItems.push(
            {
              item:
                activeItems[
                  index
                ],

              error:
                result.reason
                  ?.message ||
                "Comparison failed."
            }
          );
        }
      }
    );


    const itemsWithOffers =
      comparisons.map(
        comparison => ({
          item:
            comparison.item,

          response:
            comparison.response,

          offers:
            buildItemOffers(
              comparison
            )
        })
      );


    /*
     * Preserve items whose API call succeeded but
     * had no retailer results.
     */

    for (
      const failed of
      failedItems
    ) {
      itemsWithOffers.push({
        item:
          failed.item,

        response:
          null,

        offers:
          []
      });
    }


    const lowestCost =
      buildLowestCostPlan(
        itemsWithOffers
      );

    const bestBalance =
      buildBestBalancePlan(
        itemsWithOffers
      );

    const oneStore =
      buildOneStorePlan(
        itemsWithOffers
      );


    resultsEl.innerHTML =
      "";

    renderPlan(
      lowestCost
    );

    renderPlan(
      bestBalance
    );

    renderPlan(
      oneStore
    );

    resultsSection.hidden =
      false;


    const unavailableCount =
      itemsWithOffers.filter(
        entry =>
          !entry.offers.length
      ).length;


    if (
      unavailableCount
    ) {
      setStatus(
        `Comparison complete. ${unavailableCount} ${
          unavailableCount === 1
            ? "item did"
            : "items did"
        } not return a valid retailer price.`,
        "warning"
      );

    } else {
      setStatus(
        "Comparison complete. Your shopping options are ready.",
        "success"
      );
    }

  } catch (
    error
  ) {
    setStatus(
      error.message ||
      "Something went wrong while comparing prices.",
      "error"
    );

  } finally {
    compareButton.disabled =
      groceryList.filter(
        item =>
          !item.completed
      ).length === 0;

    addItemButton.disabled =
      false;
  }
}


/*
 * =====================================================
 * EVENTS
 * =====================================================
 */

productSelect.addEventListener(
  "change",
  () => {
    rebuildUnitOptions(
      productSelect.value
    );

    clearStatus();
  }
);


unitSelect.addEventListener(
  "change",
  () => {
    rebuildQuantityOptions(
      unitSelect.value
    );
  }
);


addItemButton.addEventListener(
  "click",
  addItem
);


resetListButton.addEventListener(
  "click",
  resetWeeklyList
);


compareButton.addEventListener(
  "click",
  compareWeeklyList
);


/*
 * =====================================================
 * INITIALIZE
 * =====================================================
 */

rebuildUnitOptions(
  productSelect.value
);

renderList();
clearResults();
clearStatus();
