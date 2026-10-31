const G29 = (() => {
  // Colours are read from the CSS variables in style.css, so changing the theme there updates every chart.
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const colours = {
    main: cssVar("--c-main", "#4C78A8"),
    highlight: cssVar("--c-highlight", "#E45756"),
    muted: cssVar("--c-muted", "#BAB0AC"),
    categories: d3.schemeTableau10,
    sequential: d3.interpolateCividis, // colour-blind safe and readable on dark or light backgrounds
  };

  // Number formats: 410884 -> "410,884", 2007387 -> "2M", 0.16 -> "16%"
  const fmt = {
    number: d3.format(","),
    compact: d3.format(".2~s"),
    percent: d3.format(".0%"),
  };

  const CAVEAT_COUNTS = "These are counts, not rates. Larger populations naturally have more hospitalisations.";

  /**
   * Load a cleaned CSV from the data folder. Numbers are converted automatically.
   * Shows a friendly message in `errorTarget` if the file fails to load.
   * @param {string} name  file name without .csv, e.g. "who_age_sex"
   * @param {string} [errorTarget] CSS selector of the chart container
   */
  // Pages inside /pages set <body data-root="../"> so data paths still work. index.html leaves it empty.
  const ROOT = document.body.dataset.root || "";

  async function loadCSV(name, errorTarget) {
    try {
      return await d3.csv(`${ROOT}data/${name}.csv`, d3.autoType);
    } catch (err) {
      console.error(`Could not load data/${name}.csv`, err);
      if (errorTarget) {
        d3.select(errorTarget).text("Sorry, the data for this chart could not be loaded.");
      }
      return [];
    }
  }

  // One shared tooltip element for the whole page.
  const tooltipEl = d3.select("body").append("div")
    .attr("class", "tooltip")
    .attr("role", "status")
    .attr("aria-live", "polite");

  const tooltip = {
    /** Show the tooltip near the mouse. `html` can include <strong> etc. */
    show(event, html) {
      tooltipEl.html(html).style("opacity", 1);
      tooltip.move(event);
    },
    move(event) {
      const pad = 14;
      tooltipEl.style("left", `${event.clientX + pad}px`).style("top", `${event.clientY + pad}px`);
    },
    hide() {
      tooltipEl.style("opacity", 0);
    },
  };

  /** Add the "counts, not rates" note under a chart container. */
  function addCaveat(selector, text = CAVEAT_COUNTS) {
    d3.select(selector).append("p").attr("class", "caveat").text(text);
  }

  /**
   * Build a year <select> with an "All years" option.
   * Calls onChange(year) where year is a number, or null for all years.
   */
  function yearSelect(selector, years, onChange) {
    const id = `${selector.replace(/[^a-z0-9]/gi, "")}-year`;
    const wrap = d3.select(selector);
    wrap.append("label").attr("for", id).text("Year ");
    const select = wrap.append("select").attr("id", id);
    select.selectAll("option")
      .data([null, ...years])
      .join("option")
      .attr("value", (d) => d ?? "all")
      .text((d) => d ?? "All years");
    select.on("change", (event) => {
      const v = event.target.value;
      onChange(v === "all" ? null : +v);
    });
  }

  /**
   * Standard SVG with margins that scales to its container width.
   * Returns { svg, g, width, height } where g is already shifted by the margins.
   */
  function makeSvg(selector, { height = 360, margin = { top: 20, right: 20, bottom: 40, left: 60 } } = {}) {
    const container = d3.select(selector);
    container.selectAll("svg").remove();
    const fullWidth = container.node().getBoundingClientRect().width || 600;
    const width = fullWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const svg = container.append("svg")
      .attr("viewBox", `0 0 ${fullWidth} ${height}`)
      .attr("width", "100%")
      .attr("role", "img");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    return { svg, g, width, height: innerHeight, margin };
  }

  // Highlight the current page in the nav, based on <body data-page="...">.
  function markCurrentPage() {
    const page = document.body.dataset.page;
    d3.selectAll(".site-nav a").each(function () {
      if (this.dataset.page === page) this.setAttribute("aria-current", "page");
    });
  }
  markCurrentPage();

  return { colours, fmt, loadCSV, tooltip, addCaveat, yearSelect, makeSvg, CAVEAT_COUNTS };
})();