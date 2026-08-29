/*
 * Toomey Grocery Optimized
 * public/app.js
 *
 * Frontend responsibilities:
 * - load permanent product catalog
 * - save custom products in browser storage
 * - save recurring weekly grocery list
 * - check product pricing
 * - send custom products to evidence-refresh
 * - surface research-needed products
 * - compare unchecked grocery items
 * - build Lowest Cost / Best Balance / One Store plans
 * - show package, quantity, freshness and confidence detail
 */


/*
 * =====================================================
 * STORAGE
 * =====================================================
 */

const WEEKLY_LIST_KEY =
  "toomey-grocery-weekly-list-v1";

const CUSTOM_PRODUCTS_KEY =
  "toomey-custom-products-v1";

const PRICING_STATUS_KEY =
  "toomey-pricing-status-v1";

const STOP_PENALTY = 5;


/*
 * =====================================================
 * DOM
 * =====================================================
 */

const productSelect =
  document.getElementById("productSelect");

const quantitySelect =
  document.getElementById("quantitySelect");

const unitSelect =
  document.getElementById("unitSelect");

const addItemButton =
  document.getElementById("addItemButton");

const resetListButton =
  document.getElementById("resetListButton");

const compareButton =
  document.getElementById("compareButton");

const groceryList =
  document.getElementById("groceryList");

const remainingItemCount =
  document.getElementById("remainingItemCount");

const statusSection =
  document.getElementById("statusSection");

const status =
  document.getElementById("status");

const resultsSection =
  document.getElementById("resultsSection");

const results =
  document.getElementById("results");

const openCustomProductButton =
  document.getElementById("openCustomProductButton");

const closeCustomProductButton =
  document.getElementById("closeCustomProductButton");

const customProductPanel =
  document.getElementById("customProductPanel");

const customProductName =
  document.getElementById("customProductName");

const customProductCategory =
  document.getElementById("customProductCategory");

const customProductDefaultUnit =
  document.getElementById("customProductDefaultUnit");

const saveCustomProductButton =
  document.getElementById("saveCustomProductButton");

const groceryItemTemplate =
  document.getElementById("groceryItemTemplate");

const optimizationCardTemplate =
  document.getElementById("optimizationCardTemplate");


/*
 * =====================================================
 * STATE
 * =====================================================
 */

let baseProducts = [];

let customProducts =
  loadStorage(
    CUSTOM_PRODUCTS_KEY,
    []
  );

let weeklyList =
  loadStorage(
    WEEKLY_LIST_KEY,
    []
  );

let pricingStatus =
  loadStorage(
    PRICING_STATUS_KEY,
    {}
  );

let catalog = [];


/*
 * =====================================================
 * STORAGE HELPERS
 * =====================================================
 */

function loadStorage(
  key,
  fallback
) {
  try {
    const raw =
      localStorage.getItem(key);

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}


function saveStorage(
  key,
  value
) {
  localStorage.setItem(
    key,
    JSON.stringify(value)
  );
}


function saveWeeklyList() {
  saveStorage(
    WEEKLY_LIST_KEY,
    weeklyList
  );
}


function saveCustomProducts() {
  saveStorage(
    CUSTOM_PRODUCTS_KEY,
    customProducts
  );
}


function savePricingStatus() {
  saveStorage(
    PRICING_STATUS_KEY,
    pricingStatus
  );
}


/*
 * =====================================================
 * TEXT HELPERS
 * =====================================================
 */

function cleanText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}


function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function titleCase(value) {
  return cleanText(value).replace(
    /\b\w/g,
    letter =>
      letter.toUpperCase()
  );
}


function money(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "—";
  }

  return number.toLocaleString(
    "en-US",
    {
      style: "currency",
      currency: "USD"
    }
  );
}


function unitLabel(unit) {
  if (unit === "fl_oz") {
    return "fl oz";
  }

  return unit || "";
}


function prettyFreshness(value) {
  if (!value) {
    return null;
  }

  const map = {
    current: "Current price",
    aging: "Price aging",
    stale: "Price stale",
    unknown: "Price date unknown"
  };

  return (
    map[value] ||
    titleCase(value)
  );
}


function confidenceLabel(score) {
  const number =
    Number(score);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  if (number >= 90) {
    return `High confidence ${Math.round(number)}%`;
  }

  if (number >= 70) {
    return `Good confidence ${Math.round(number)}%`;
  }

  return `Confidence ${Math.round(number)}%`;
}


/*
 * =====================================================
 * PRODUCT NORMALIZATION
 * =====================================================
 */

function normalizeProduct(
  product,
  custom = false
) {
  if (!product) {
    return null;
  }

  const defaultUnit =
    product.defaultUnit ||
    product.unit ||
    "each";

  const label =
    product.label ||
    product.name ||
    product.queryName ||
    "Unnamed product";

  const id =
    product.id ||
    `custom-${slugify(label)}`;

  return {
    id,

    label,

    queryName:
      product.queryName ||
      label,

    category:
      product.category ||
      "Other",

    defaultUnit,

    allowedUnits:
      Array.isArray(
        product.allowedUnits
      ) &&
      product.allowedUnits.length
        ? product.allowedUnits
        : [defaultUnit],

    custom:
      Boolean(
        custom ||
        product.custom
      )
  };
}


function rebuildCatalog() {
  const normalizedBase =
    baseProducts
      .map(
        product =>
          normalizeProduct(
            product,
            false
          )
      )
      .filter(Boolean);

  const normalizedCustom =
    customProducts
      .map(
        product =>
          normalizeProduct(
            product,
            true
          )
      )
      .filter(Boolean);

  const map =
    new Map();

  for (
    const product of
    [
      ...normalizedBase,
      ...normalizedCustom
    ]
  ) {
    if (
      !map.has(product.id)
    ) {
      map.set(
        product.id,
        product
      );
    }
  }

  catalog =
    [...map.values()];

  populateProductDropdown();
}


/*
 * =====================================================
 * LOAD PRODUCTS
 * =====================================================
 */

async function loadProducts() {
  try {
    const response =
      await fetch(
        "/products.json",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Could not load product catalog."
      );
    }

    const data =
      await response.json();

    baseProducts =
      Array.isArray(data)
        ? data
        : [];

  } catch (error) {
    console.error(error);

    baseProducts = [];
  }

  rebuildCatalog();
  renderWeeklyList();
}


/*
 * =====================================================
 * PRODUCT DROPDOWN
 * =====================================================
 */

function populateProductDropdown() {
  if (!productSelect) {
    return;
  }

  const selected =
    productSelect.value;

  productSelect.innerHTML = "";

  const placeholder =
    document.createElement(
      "option"
    );

  placeholder.value = "";

  placeholder.textContent =
    "Select a product";

  productSelect.appendChild(
    placeholder
  );

  const groups =
    new Map();

  for (
    const product of
    catalog
  ) {
    const category =
      product.category ||
      "Other";

    if (
      !groups.has(category)
    ) {
      groups.set(
        category,
        []
      );
    }

    groups
      .get(category)
      .push(product);
  }

  const sortedCategories =
    [...groups.keys()].sort();

  for (
    const category of
    sortedCategories
  ) {
    const optgroup =
      document.createElement(
        "optgroup"
      );

    optgroup.label =
      category;

    const products =
      groups
        .get(category)
        .sort(
          (a, b) =>
            a.label.localeCompare(
              b.label
            )
        );

    for (
      const product of
      products
    ) {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        product.id;

      option.textContent =
        product.custom
          ? `${product.label} • Custom`
          : product.label;

      optgroup.appendChild(
        option
      );
    }

    productSelect.appendChild(
      optgroup
    );
  }

  if (
    catalog.some(
      product =>
        product.id ===
        selected
    )
  ) {
    productSelect.value =
      selected;
  }

  syncUnitDropdown();
}


/*
 * =====================================================
 * QUANTITY DROPDOWN
 * =====================================================
 */

function populateQuantityDropdown() {
  if (!quantitySelect) {
    return;
  }

  const values = [
    0.25,
    0.5,
    0.75,
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
    12,
    16,
    20,
    24,
    30,
    36,
    40,
    50,
    60,
    75,
    100
  ];

  quantitySelect.innerHTML = "";

  for (
    const value of
    values
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(value);

    option.textContent =
      String(value);

    quantitySelect.appendChild(
      option
    );
  }

  quantitySelect.value =
    "1";
}


/*
 * =====================================================
 * CURRENT PRODUCT
 * =====================================================
 */

function getProductById(id) {
  return (
    catalog.find(
      product =>
        product.id === id
    ) ||
    null
  );
}


function currentSelectedProduct() {
  return getProductById(
    productSelect?.value
  );
}


/*
 * =====================================================
 * UNIT DROPDOWN
 * =====================================================
 */

function syncUnitDropdown() {
  if (!unitSelect) {
    return;
  }

  const product =
    currentSelectedProduct();

  unitSelect.innerHTML = "";

  const units =
    product?.allowedUnits?.length
      ? product.allowedUnits
      : [
          product?.defaultUnit ||
          "each"
        ];

  for (
    const unit of
    units
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      unit;

    option.textContent =
      unitLabel(unit);

    unitSelect.appendChild(
      option
    );
  }

  if (
    product?.defaultUnit
  ) {
    unitSelect.value =
      product.defaultUnit;
  }
}


/*
 * =====================================================
 * CUSTOM PRODUCT PANEL
 * =====================================================
 */

function openCustomProductPanel() {
  if (!customProductPanel) {
    return;
  }

  customProductPanel.hidden =
    false;

  customProductPanel.classList
    .remove("hidden");

  requestAnimationFrame(
    () => {
      customProductName
        ?.focus();
    }
  );
}


function closeCustomProductPanel() {
  if (!customProductPanel) {
    return;
  }

  customProductPanel.hidden =
    true;

  customProductPanel.classList
    .add("hidden");
}


/*
 * =====================================================
 * SAVE CUSTOM PRODUCT
 * =====================================================
 */

async function saveCustomProduct() {
  const rawName =
    cleanText(
      customProductName
        ?.value
    );

  if (!rawName) {
    showStatus(
      "Enter a product name first."
    );

    return;
  }

  const unit =
    customProductDefaultUnit
      ?.value ||
    "each";

  const id =
    `custom-${slugify(rawName)}`;

  const duplicate =
    catalog.find(
      product =>
        product.id === id ||
        product.label
          .toLowerCase() ===
        rawName.toLowerCase()
    );

  if (duplicate) {
    productSelect.value =
      duplicate.id;

    syncUnitDropdown();

    closeCustomProductPanel();

    showStatus(
      `${duplicate.label} is already saved.`
    );

    return;
  }

  const product = {
    id,

    label:
      titleCase(rawName),

    queryName:
      rawName,

    category:
      customProductCategory
        ?.value ||
      "Other",

    defaultUnit:
      unit,

    allowedUnits:
      [unit],

    custom:
      true
  };

  customProducts.push(
    product
  );

  saveCustomProducts();

  rebuildCatalog();

  productSelect.value =
    product.id;

  syncUnitDropdown();

  if (
    customProductName
  ) {
    customProductName.value =
      "";
  }

  closeCustomProductPanel();

  showStatus(
    `${product.label} saved. Checking pricing coverage…`
  );

  await checkProductPricing(
    product,
    1,
    unit
  );

  await refreshCustomProductResearch();
}


/*
 * =====================================================
 * ADD WEEKLY ITEM
 * =====================================================
 */

async function addSelectedItem() {
  const product =
    currentSelectedProduct();

  if (!product) {
    showStatus(
      "Select a product first."
    );

    return;
  }

  const quantity =
    Number(
      quantitySelect?.value ||
      1
    );

  const unit =
    unitSelect?.value ||
    product.defaultUnit ||
    "each";

  const existing =
    weeklyList.find(
      item =>
        item.productId ===
          product.id &&
        item.unit ===
          unit &&
        !item.checked
    );

  if (existing) {
    existing.quantity =
      Number(
        existing.quantity ||
        0
      ) +
      quantity;

  } else {
    weeklyList.push({
      id:
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      productId:
        product.id,

      label:
        product.label,

      queryName:
        product.queryName,

      quantity,

      unit,

      checked:
        false,

      custom:
        Boolean(
          product.custom
        )
    });
  }

  saveWeeklyList();

  renderWeeklyList();

  showStatus(
    `${product.label} added to your weekly list.`
  );

  if (
    product.custom
  ) {
    await checkProductPricing(
      product,
      quantity,
      unit
    );

    await refreshCustomProductResearch();
  }
}


/*
 * =====================================================
 * PRICING STATUS
 * =====================================================
 */

function inferPricingStatus(data) {
  const retailerNames =
    Array.isArray(
      data?.results
    )
      ? [
          ...new Set(
            data.results
              .map(
                result =>
                  result.retailer
              )
              .filter(Boolean)
          )
        ]
      : [];

  if (
    retailerNames.length >= 2
  ) {
    return {
      status: "available",

      label:
        "Pricing available",

      retailers:
        retailerNames
    };
  }

  if (
    retailerNames.length === 1
  ) {
    return {
      status: "partial",

      label:
        "Partial pricing",

      retailers:
        retailerNames
    };
  }

  return {
    status: "research",

    label:
      "Research needed",

    retailers: []
  };
}


async function checkProductPricing(
  product,
  quantity = 1,
  unit = null
) {
  if (!product) {
    return null;
  }

  const requestedUnit =
    unit ||
    product.defaultUnit ||
    "each";

  const query =
    `${quantity} ${requestedUnit} ${product.queryName}`;

  try {
    const response =
      await fetch(
        `/api/compare?q=${encodeURIComponent(
          query
        )}`,
        {
          cache:
            "no-store"
        }
      );

    const data =
      await response.json();

    const inferred =
      inferPricingStatus(data);

    pricingStatus[
      product.id
    ] = {
      ...inferred,

      checkedAt:
        new Date()
          .toISOString()
    };

    savePricingStatus();

    renderWeeklyList();

    return inferred;

  } catch (error) {
    console.error(
      "Pricing check failed:",
      error
    );

    pricingStatus[
      product.id
    ] = {
      status:
        "research",

      label:
        "Research needed",

      retailers: [],

      checkedAt:
        new Date()
          .toISOString()
    };

    savePricingStatus();

    renderWeeklyList();

    return (
      pricingStatus[
        product.id
      ]
    );
  }
}


/*
 * =====================================================
 * CUSTOM PRODUCT RESEARCH REFRESH
 * =====================================================
 */

async function refreshCustomProductResearch() {
  try {
    const response =
      await fetch(
        "/api/evidence-refresh",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              customProducts
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Evidence refresh returned ${response.status}.`
      );
    }

    const data =
      await response.json();

    if (!data?.ok) {
      return null;
    }

    updatePricingFromRefreshPlan(
      data
    );

    return data;

  } catch (error) {
    console.error(
      "Custom evidence refresh failed:",
      error
    );

    return null;
  }
}


/*
 * =====================================================
 * USE REFRESH PLAN
 * =====================================================
 */

function updatePricingFromRefreshPlan(
  data
) {
  const retailerPlans =
    [
      data?.retailers?.sprouts,
      data?.retailers?.earthFare
    ]
      .filter(Boolean);

  for (
    const product of
    customProducts
  ) {
    const researchRetailers =
      [];

    for (
      const plan of
      retailerPlans
    ) {
      const target =
        plan.targets?.find(
          item =>
            item.id ===
            normalizeCustomRefreshId(
              product
            )
        );

      if (target) {
        researchRetailers.push(
          plan.retailer
        );
      }
    }

    const existing =
      pricingStatus[
        product.id
      ];

    if (
      researchRetailers.length &&
      (
        !existing ||
        existing.status ===
          "research"
      )
    ) {
      pricingStatus[
        product.id
      ] = {
        status:
          "research",

        label:
          "Research needed",

        retailers: [],

        researchRetailers,

        checkedAt:
          new Date()
            .toISOString()
      };
    }
  }

  savePricingStatus();

  renderWeeklyList();
}


/*
 * =====================================================
 * CUSTOM ID NORMALIZATION
 * =====================================================
 */

const MASS_OR_UNCHANGED_WORDS =
  new Set([
    "beef",
    "bread",
    "broccoli",
    "cheese",
    "coffee",
    "fish",
    "milk",
    "oats",
    "oil",
    "quinoa",
    "rice",
    "soap",
    "spinach",
    "turkey",
    "water"
  ]);


const IRREGULAR_PLURALS = {
  potato: "potatoes",
  tomato: "tomatoes",
  berry: "berries",
  cherry: "cherries",
  strawberry: "strawberries",
  blueberry: "blueberries",
  raspberry: "raspberries",
  cranberry: "cranberries"
};


function pluralizeCustomWord(word) {
  const value =
    cleanText(word)
      .toLowerCase();

  if (!value) {
    return value;
  }

  if (
    MASS_OR_UNCHANGED_WORDS
      .has(value)
  ) {
    return value;
  }

  if (
    IRREGULAR_PLURALS[value]
  ) {
    return (
      IRREGULAR_PLURALS[value]
    );
  }

  if (
    value.endsWith("ies") ||
    value.endsWith("oes")
  ) {
    return value;
  }

  if (
    value.endsWith("s") &&
    !value.endsWith("ss")
  ) {
    return value;
  }

  if (
    /[^aeiou]y$/.test(value)
  ) {
    return (
      value.slice(0, -1) +
      "ies"
    );
  }

  if (
    /(s|x|z|ch|sh)$/.test(
      value
    )
  ) {
    return (
      value +
      "es"
    );
  }

  return (
    value +
    "s"
  );
}


function normalizeCustomRefreshId(
  product
) {
  const rawName =
    product.queryName ||
    product.label ||
    "";

  const words =
    cleanText(rawName)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return product.id;
  }

  words[
    words.length - 1
  ] =
    pluralizeCustomWord(
      words[
        words.length - 1
      ]
    );

  return (
    `custom-${slugify(
      words.join(" ")
    )}`
  );
}


/*
 * =====================================================
 * WEEKLY LIST DISPLAY
 * =====================================================
 */

function pricingLabelForProduct(
  productId
) {
  const pricing =
    pricingStatus[
      productId
    ];

  if (!pricing) {
    return (
      "Pricing not checked"
    );
  }

  if (
    pricing.status ===
    "available"
  ) {
    return (
      pricing.retailers
        ?.length
        ? `Pricing available: ${pricing.retailers.join(", ")}`
        : "Pricing available"
    );
  }

  if (
    pricing.status ===
    "partial"
  ) {
    return (
      pricing.retailers
        ?.length
        ? `Partial pricing: ${pricing.retailers.join(", ")}`
        : "Partial pricing"
    );
  }

  return (
    "Research needed"
  );
}


function renderWeeklyList() {
  if (!groceryList) {
    return;
  }

  groceryList.innerHTML = "";

  if (!weeklyList.length) {
    const empty =
      document.createElement(
        "p"
      );

    empty.className =
      "grocery-empty";

    empty.textContent =
      "Your weekly grocery list is empty.";

    groceryList.appendChild(
      empty
    );

    updateRemainingCount();

    return;
  }

  for (
    const item of
    weeklyList
  ) {
    const fragment =
      groceryItemTemplate
        ?.content
        ?.cloneNode(true);

    if (!fragment) {
      continue;
    }

    const article =
      fragment.querySelector(
        ".grocery-item"
      );

    const checkbox =
      fragment.querySelector(
        ".grocery-check"
      );

    const productName =
      fragment.querySelector(
        ".grocery-item-product"
      );

    const meta =
      fragment.querySelector(
        ".grocery-item-meta"
      );

    const remove =
      fragment.querySelector(
        ".grocery-remove"
      );

    if (productName) {
      productName.textContent =
        item.label;
    }

    if (checkbox) {
      checkbox.checked =
        Boolean(item.checked);

      checkbox.addEventListener(
        "change",
        () => {
          item.checked =
            checkbox.checked;

          saveWeeklyList();

          renderWeeklyList();
        }
      );
    }

    if (
      article &&
      item.checked
    ) {
      article.classList.add(
        "is-complete"
      );
    }

    if (meta) {
      meta.textContent =
        [
          `${item.quantity} ${unitLabel(
            item.unit
          )}`,

          pricingLabelForProduct(
            item.productId
          )
        ]
          .filter(Boolean)
          .join(" · ");
    }

    if (remove) {
      remove.addEventListener(
        "click",
        () => {
          removeWeeklyItem(
            item.id
          );
        }
      );
    }

    groceryList.appendChild(
      fragment
    );
  }

  updateRemainingCount();
}


/*
 * =====================================================
 * REMOVE / RESET
 * =====================================================
 */

function removeWeeklyItem(itemId) {
  weeklyList =
    weeklyList.filter(
      item =>
        item.id !== itemId
    );

  saveWeeklyList();

  renderWeeklyList();
}


function resetWeeklyList() {
  weeklyList =
    weeklyList.map(
      item => ({
        ...item,
        checked: false
      })
    );

  saveWeeklyList();

  renderWeeklyList();

  showStatus(
    "Weekly list reset. All items are ready to shop again."
  );
}


/*
 * =====================================================
 * REMAINING COUNT
 * =====================================================
 */

function updateRemainingCount() {
  if (!remainingItemCount) {
    return;
  }

  const count =
    weeklyList.filter(
      item =>
        !item.checked
    ).length;

  remainingItemCount.textContent =
    `${count} ${
      count === 1
        ? "item"
        : "items"
    } to compare`;
}


/*
 * =====================================================
 * STATUS
 * =====================================================
 */

function hideStatus() {
  if (statusSection) {
    statusSection.hidden =
      true;
  }
}


function showStatus(message) {
  if (
    !statusSection ||
    !status
  ) {
    return;
  }

  status.textContent =
    message;

  statusSection.hidden =
    false;
}


/*
 * =====================================================
 * COMPARE
 * =====================================================
 */

function buildCompareQuery(
  item,
  product
) {
  return (
    `${item.quantity} ${item.unit} ${product.queryName}`
  );
}


async function compareItem(item) {
  const product =
    getProductById(
      item.productId
    ) ||
    {
      id:
        item.productId,

      label:
        item.label,

      queryName:
        item.queryName ||
        item.label,

      defaultUnit:
        item.unit,

      custom:
        item.custom
    };

  const query =
    buildCompareQuery(
      item,
      product
    );

  const response =
    await fetch(
      `/api/compare?q=${encodeURIComponent(
        query
      )}`,
      {
        cache:
          "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      `Compare request failed for ${item.label}.`
    );
  }

  const data =
    await response.json();

  const normalizedResults =
    Array.isArray(
      data.results
    )
      ? data.results
          .map(
            result => ({
              ...result,

              cost:
                Number(
                  result.estimatedCost ??
                  result.cost
                )
            })
          )
          .filter(
            result =>
              Number.isFinite(
                result.cost
              )
          )
      : [];

  const inferred =
    inferPricingStatus({
      results:
        normalizedResults
    });

  pricingStatus[
    product.id
  ] = {
    ...inferred,

    checkedAt:
      new Date()
        .toISOString()
  };

  return {
    item,
    product,
    data,
    results:
      normalizedResults
  };
}


/*
 * =====================================================
 * LOWEST COST
 * =====================================================
 */

function buildLowestCostPlan(
  comparisons
) {
  const selections = [];

  for (
    const comparison of
    comparisons
  ) {
    const cheapest =
      comparison.results
        .slice()
        .sort(
          (a, b) =>
            a.cost -
            b.cost
        )[0];

    if (!cheapest) {
      continue;
    }

    selections.push({
      item:
        comparison.item,

      retailer:
        cheapest.retailer,

      cost:
        cheapest.cost,

      result:
        cheapest
    });
  }

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

  return {
    label:
      "Lowest Cost",

    title:
      "Cheapest valid combination",

    total,

    selections,

    stores:
      [
        ...new Set(
          selections.map(
            selection =>
              selection.retailer
          )
        )
      ]
  };
}


/*
 * =====================================================
 * COMBINATIONS
 * =====================================================
 */

function combinations(array) {
  const result = [];

  const total =
    1 << array.length;

  for (
    let mask = 1;
    mask < total;
    mask++
  ) {
    const subset = [];

    for (
      let index = 0;
      index < array.length;
      index++
    ) {
      if (
        mask &
        (1 << index)
      ) {
        subset.push(
          array[index]
        );
      }
    }

    result.push(
      subset
    );
  }

  return result;
}


/*
 * =====================================================
 * BEST BALANCE
 * =====================================================
 */

function buildBestBalancePlan(
  comparisons
) {
  const retailers =
    [
      ...new Set(
        comparisons.flatMap(
          comparison =>
            comparison.results.map(
              result =>
                result.retailer
            )
        )
      )
    ];

  if (!retailers.length) {
    return null;
  }

  const subsets =
    combinations(retailers);

  let best = null;

  for (
    const subset of
    subsets
  ) {
    const selections = [];

    let incomplete =
      false;

    for (
      const comparison of
      comparisons
    ) {
      const options =
        comparison.results
          .filter(
            result =>
              subset.includes(
                result.retailer
              )
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          );

      if (!options.length) {
        incomplete =
          true;

        break;
      }

      selections.push({
        item:
          comparison.item,

        retailer:
          options[0]
            .retailer,

        cost:
          options[0]
            .cost,

        result:
          options[0]
      });
    }

    if (incomplete) {
      continue;
    }

    const groceryTotal =
      selections.reduce(
        (
          sum,
          selection
        ) =>
          sum +
          selection.cost,
        0
      );

    const usedStores =
      [
        ...new Set(
          selections.map(
            selection =>
              selection.retailer
          )
        )
      ];

    const penalty =
      Math.max(
        0,
        usedStores.length - 1
      ) *
      STOP_PENALTY;

    const score =
      groceryTotal +
      penalty;

    if (
      !best ||
      score < best.score
    ) {
      best = {
        label:
          "Best Balance",

        title:
          "Lower cost with fewer stops",

        total:
          groceryTotal,

        score,

        selections,

        stores:
          usedStores
      };
    }
  }

  return best;
}


/*
 * =====================================================
 * ONE STORE
 * =====================================================
 */

function buildOneStorePlan(
  comparisons
) {
  const retailerMap =
    new Map();

  for (
    const comparison of
    comparisons
  ) {
    for (
      const result of
      comparison.results
    ) {
      if (
        !retailerMap.has(
          result.retailer
        )
      ) {
        retailerMap.set(
          result.retailer,
          []
        );
      }

      retailerMap
        .get(result.retailer)
        .push({
          comparison,
          result
        });
    }
  }

  let best = null;

  for (
    const [
      retailer,
      entries
    ] of retailerMap
  ) {
    const coveredItems =
      new Set(
        entries.map(
          entry =>
            entry.comparison
              .item.id
        )
      );

    const selections = [];

    for (
      const comparison of
      comparisons
    ) {
      const option =
        comparison.results
          .filter(
            result =>
              result.retailer ===
              retailer
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          )[0];

      if (option) {
        selections.push({
          item:
            comparison.item,

          retailer,

          cost:
            option.cost,

          result:
            option
        });
      }
    }

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

    const candidate = {
      label:
        "One Store",

      title:
        retailer,

      total,

      coverage:
        coveredItems.size,

      selections,

      stores:
        [retailer]
    };

    if (
      !best ||
      candidate.coverage >
        best.coverage ||
      (
        candidate.coverage ===
          best.coverage &&
        candidate.total <
          best.total
      )
    ) {
      best =
        candidate;
    }
  }

  return best;
}


/*
 * =====================================================
 * PACKAGE DETAIL
 * =====================================================
 */

function getPrimaryPackage(
  result
) {
  if (
    Array.isArray(
      result?.packages
    ) &&
    result.packages.length
  ) {
    return result.packages[0];
  }

  return null;
}


function packageDetailText(
  result
) {
  const packageInfo =
    getPrimaryPackage(
      result
    );

  const parts = [];

  const packagesNeeded =
    Number(
      packageInfo
        ?.packagesNeeded ||
      result?.purchasePlan
        ?.packagesNeeded ||
      result?.packages?.length ||
      0
    );

  if (
    Number.isFinite(
      packagesNeeded
    ) &&
    packagesNeeded > 0
  ) {
    parts.push(
      `${packagesNeeded} ${
        packagesNeeded === 1
          ? "package"
          : "packages"
      }`
    );
  }

  if (
    packageInfo?.size
  ) {
    parts.push(
      packageInfo.size
    );
  } else if (
    packageInfo?.packageQty &&
    packageInfo?.packageUnit
  ) {
    parts.push(
      `${packageInfo.packageQty} ${unitLabel(
        packageInfo.packageUnit
      )}`
    );
  }

  const supplied =
    Number(
      result?.normalized
        ?.suppliedQty
    );

  const suppliedUnit =
    result?.normalized?.unit;

  if (
    Number.isFinite(supplied) &&
    suppliedUnit
  ) {
    parts.push(
      `${supplied} ${unitLabel(
        suppliedUnit
      )} supplied`
    );
  }

  return parts.join(" · ");
}


function evidenceDetailText(
  result
) {
  const parts = [];

  const freshness =
    prettyFreshness(
      result?.freshness
    );

  if (freshness) {
    parts.push(
      freshness
    );
  }

  if (
    Number.isFinite(
      Number(
        result?.ageDays
      )
    )
  ) {
    const days =
      Number(result.ageDays);

    parts.push(
      days === 0
        ? "Observed today"
        : `${days} ${
            days === 1
              ? "day"
              : "days"
          } old`
    );
  }

  const confidence =
    confidenceLabel(
      result?.confidenceScore
    );

  if (confidence) {
    parts.push(
      confidence
    );
  }

  if (
    result?.dataMode ===
    "live"
  ) {
    parts.unshift(
      "Live retailer data"
    );
  }

  return parts.join(" · ");
}


/*
 * =====================================================
 * RESULTS DISPLAY
 * =====================================================
 */

function renderPlan(plan) {
  if (
    !plan ||
    !optimizationCardTemplate
  ) {
    return;
  }

  const fragment =
    optimizationCardTemplate
      .content
      .cloneNode(true);

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

  const stores =
    fragment.querySelector(
      ".optimization-stores"
    );

  if (label) {
    label.textContent =
      plan.label;
  }

  if (title) {
    title.textContent =
      plan.title;
  }

  if (total) {
    total.textContent =
      money(plan.total);
  }

  if (meta) {
    meta.textContent =
      `${plan.selections.length} ${
        plan.selections.length === 1
          ? "item"
          : "items"
      } · ${plan.stores.length} ${
        plan.stores.length === 1
          ? "store"
          : "stores"
      }`;
  }

  if (stores) {
    for (
      const selection of
      plan.selections
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "optimization-store-row";

      /*
       * Product / package information
       */

      const itemWrap =
        document.createElement(
          "div"
        );

      itemWrap.style.minWidth =
        "0";

      const item =
        document.createElement(
          "div"
        );

      item.className =
        "optimization-store-item";

      item.textContent =
        selection.item.label;

      itemWrap.appendChild(
        item
      );

      const packageDetail =
        packageDetailText(
          selection.result
        );

      if (packageDetail) {
        const detail =
          document.createElement(
            "div"
          );

        detail.style.marginTop =
          "3px";

        detail.style.fontSize =
          "0.72rem";

        detail.style.lineHeight =
          "1.35";

        detail.style.color =
          "var(--muted)";

        detail.textContent =
          packageDetail;

        itemWrap.appendChild(
          detail
        );
      }

      const retailer =
        document.createElement(
          "div"
        );

      retailer.className =
        "optimization-store-name";

      retailer.textContent =
        selection.retailer;

      const evidence =
        evidenceDetailText(
          selection.result
        );

      if (evidence) {
        const evidenceText =
          document.createElement(
            "div"
          );

        evidenceText.style.marginTop =
          "3px";

        evidenceText.style.maxWidth =
          "160px";

        evidenceText.style.fontSize =
          "0.68rem";

        evidenceText.style.lineHeight =
          "1.35";

        evidenceText.style.color =
          "var(--muted-light)";

        evidenceText.textContent =
          evidence;

        retailer.appendChild(
          evidenceText
        );
      }

      const price =
        document.createElement(
          "strong"
        );

      price.className =
        "optimization-store-price";

      price.textContent =
        money(
          selection.cost
        );

      row.append(
        itemWrap,
        retailer,
        price
      );

      stores.appendChild(
        row
      );
    }
  }

  results.appendChild(
    fragment
  );
}


/*
 * =====================================================
 * COMPARE WEEKLY LIST
 * =====================================================
 */

async function compareWeeklyList() {
  const items =
    weeklyList.filter(
      item =>
        !item.checked
    );

  if (!items.length) {
    showStatus(
      "There are no unchecked items to compare."
    );

    return;
  }

  compareButton.disabled =
    true;

  showStatus(
    `Comparing ${items.length} ${
      items.length === 1
        ? "item"
        : "items"
    }…`
  );

  try {
    await refreshCustomProductResearch();

    const comparisons =
      await Promise.all(
        items.map(compareItem)
      );

    savePricingStatus();

    renderWeeklyList();

    const withResults =
      comparisons.filter(
        comparison =>
          comparison.results
            .length
      );

    const withoutResults =
      comparisons.filter(
        comparison =>
          !comparison.results
            .length
      );

    results.innerHTML = "";

    if (!withResults.length) {
      resultsSection.hidden =
        true;

      showStatus(
        "No reliable retailer pricing is available yet for the unchecked items. Those products remain marked Research needed."
      );

      return;
    }

    const lowest =
      buildLowestCostPlan(
        withResults
      );

    const balanced =
      buildBestBalancePlan(
        withResults
      );

    const oneStore =
      buildOneStorePlan(
        withResults
      );

    renderPlan(lowest);

    renderPlan(balanced);

    renderPlan(oneStore);

    resultsSection.hidden =
      false;

    if (
      withoutResults.length
    ) {
      showStatus(
        `Comparison complete for ${withResults.length} items. ${withoutResults.length} ${
          withoutResults.length === 1
            ? "item still needs"
            : "items still need"
        } pricing research.`
      );

    } else {
      showStatus(
        "Comparison complete."
      );
    }

  } catch (error) {
    console.error(error);

    showStatus(
      "Something went wrong while comparing prices. Please try again."
    );

  } finally {
    compareButton.disabled =
      false;
  }
}


/*
 * =====================================================
 * EVENTS
 * =====================================================
 */

productSelect
  ?.addEventListener(
    "change",
    syncUnitDropdown
  );


addItemButton
  ?.addEventListener(
    "click",
    addSelectedItem
  );


resetListButton
  ?.addEventListener(
    "click",
    resetWeeklyList
  );


compareButton
  ?.addEventListener(
    "click",
    compareWeeklyList
  );


openCustomProductButton
  ?.addEventListener(
    "click",
    openCustomProductPanel
  );


closeCustomProductButton
  ?.addEventListener(
    "click",
    closeCustomProductPanel
  );


saveCustomProductButton
  ?.addEventListener(
    "click",
    saveCustomProduct
  );


customProductName
  ?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        saveCustomProduct();
      }
    }
  );


/*
 * =====================================================
 * INITIALIZE
 * =====================================================
 */

async function initialize() {
  hideStatus();

  if (resultsSection) {
    resultsSection.hidden =
      true;
  }

  populateQuantityDropdown();

  await loadProducts();

  if (
    customProducts.length
  ) {
    await refreshCustomProductResearch();
  }
}


initialize();
