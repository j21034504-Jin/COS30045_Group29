/*
 * time.js — Over time page: calendar heatmap and trend by group.
 * Owner: Soon Mung Hing
 * Data: data/trend_month.csv (Year, Month, month_num, Hospitalisations)
 *       data/trend_year_group.csv (Year, group, Hospitalisations, group_type)
 * GenAI note: written with help from Claude (Anthropic) and reviewed by Group 29.
 */

const GROUP_LABELS = { road_user: "road user", age_group: "age group", sex: "sex", remoteness: "remoteness area" };
// Age groups must be in age order, not alphabetical ("8-16" would sort after "75+")
const AGE_ORDER = ["0-7", "8-16", "17-25", "26-39", "40-64", "65-74", "75+"];
// Very small groups swing wildly when indexed, so they are not picked as the "fastest growing" story
const MIN_BASE_FOR_STORY = 500;

const state = { groupType: "road_user", mode: "count", selected: null };

(async function init() {
  const [months, groups] = await Promise.all([
    G29.loadCSV("trend_month", "#chart-calendar"),
    G29.loadCSV("trend_year_group", "#chart-groups"),
  ]);

  if (months.length) drawCalendar(months);

  if (groups.length) {
    makeToggle("#chart-groups-controls", [
      { value: "count", label: "Count" },
      { value: "index", label: "Index (2011 = 100)" },
    ], (mode) => { state.mode = mode; drawGroups(groups); }, "Show counts or index");

    d3.select("#group-type").on("change", (event) => {
      state.groupType = event.target.value;
      state.selected = null;
      drawGroups(groups);
    });
    drawGroups(groups);
  }

  window.addEventListener("resize", debounce(() => {
    if (months.length) drawCalendar(months);
    if (groups.length) drawGroups(groups);
  }, 200));
})();

/* ---------- Calendar heatmap: years down, months across ---------- */
function drawCalendar(data) {
  const years = [...new Set(data.map((d) => d.Year))].sort((a, b) => a - b);
  const monthNames = d3.range(1, 13).map((m) => data.find((d) => d.month_num === m).Month);
  const lowest = d3.least(data, (d) => d.Hospitalisations);
  const highest = d3.greatest(data, (d) => d.Hospitalisations);

  const { svg, g, width, height } = G29.makeSvg("#chart-calendar", {
    height: 420, margin: { top: 28, right: 10, bottom: 10, left: 48 },
  });
  svg.attr("aria-label", `Heatmap of road crash hospitalisations for each month from 2011 to 2021. ` +
    `The lowest month is ${lowest.Month} ${lowest.Year} with ${G29.fmt.number(lowest.Hospitalisations)}; ` +
    `the highest is ${highest.Month} ${highest.Year} with ${G29.fmt.number(highest.Hospitalisations)}.`);

  const x = d3.scaleBand().domain(d3.range(1, 13)).range([0, width]).padding(0.08);
  const y = d3.scaleBand().domain(years).range([0, height]).padding(0.08);
  const colour = d3.scaleSequential(G29.colours.sequential)
    .domain(d3.extent(data, (d) => d.Hospitalisations));

  // Month labels on top (short names on narrow screens), years down the left
  const short = width < 500;
  g.append("g").selectAll("text").data(d3.range(1, 13)).join("text")
    .attr("x", (m) => x(m) + x.bandwidth() / 2).attr("y", -10).attr("text-anchor", "middle")
    .text((m) => (short ? monthNames[m - 1][0] : monthNames[m - 1].slice(0, 3)));
  g.append("g").selectAll("text").data(years).join("text")
    .attr("x", -10).attr("y", (yr) => y(yr) + y.bandwidth() / 2).attr("dy", "0.35em").attr("text-anchor", "end")
    .text((yr) => yr);

  g.selectAll("rect.cell")
    .data(data)
    .join("rect")
    .attr("class", "cell")
    .attr("x", (d) => x(d.month_num))
    .attr("y", (d) => y(d.Year))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", 4)
    .attr("fill", (d) => colour(d.Hospitalisations))
    .on("mouseenter", (event, d) => {
      d3.select(event.currentTarget).attr("stroke", "var(--c-text)").attr("stroke-width", 2);
      const avg = d3.mean(data.filter((o) => o.month_num === d.month_num), (o) => o.Hospitalisations);
      const diff = d.Hospitalisations / avg - 1;
      G29.tooltip.show(event, `<strong>${d.Month} ${d.Year}</strong><br>${G29.fmt.number(d.Hospitalisations)} hospitalisations` +
        `<br>${diff >= 0 ? "+" : ""}${Math.round(diff * 100)}% vs the average ${d.Month}`);
    })
    .on("mousemove", (event) => G29.tooltip.move(event))
    .on("mouseleave", (event) => {
      d3.select(event.currentTarget).attr("stroke", null);
      G29.tooltip.hide();
      outlineLowest();
    });

  // Story point: outline the lowest month (April 2020) in red, and say so in text
  function outlineLowest() {
    g.selectAll("rect.lowest").remove();
    g.append("rect").attr("class", "lowest")
      .attr("x", x(lowest.month_num) - 2).attr("y", y(lowest.Year) - 2)
      .attr("width", x.bandwidth() + 4).attr("height", y.bandwidth() + 4).attr("rx", 6)
      .attr("fill", "none").attr("stroke", G29.colours.highlight).attr("stroke-width", 3)
      .attr("pointer-events", "none");
  }
  outlineLowest();

  // Colour legend under the chart
  const legend = d3.select("#chart-calendar-legend").html("");
  const [lo, hi] = colour.domain();
  legend.append("span").text(G29.fmt.number(lo));
  legend.append("span").attr("class", "bar")
    .style("background", `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((t) => G29.colours.sequential(t)).join(",")})`);
  legend.append("span").text(`${G29.fmt.number(hi)} hospitalisations a month`);
  legend.append("span").style("margin-left", "16px").style("color", G29.colours.highlight)
    .text(`▢ ${lowest.Month} ${lowest.Year}: ${G29.fmt.number(lowest.Hospitalisations)}, the lowest month (COVID-19 lockdowns)`);
}

/* ---------- Trend by group: one line per group ---------- */
function drawGroups(all) {
  const rows = all.filter((d) => d.group_type === state.groupType);
  let names = [...new Set(rows.map((d) => d.group))];
  if (state.groupType === "age_group") names = AGE_ORDER.filter((n) => names.includes(n));
  else names.sort();

  // One series per group, with the index (2011 = 100) worked out here
  const series = names.map((name) => {
    const values = rows.filter((d) => d.group === name).sort((a, b) => a.Year - b.Year);
    const base = values[0].Hospitalisations;
    return {
      name,
      base,
      last: values[values.length - 1].Hospitalisations,
      values: values.map((d) => ({ Year: d.Year, count: d.Hospitalisations, index: (d.Hospitalisations / base) * 100 })),
    };
  });
  series.forEach((s) => { s.growth = s.last / s.base - 1; });

  // The story group is the fastest grower (ignoring tiny groups); it is drawn in the highlight colour
  const story = d3.greatest(series.filter((s) => s.base >= MIN_BASE_FOR_STORY), (s) => s.growth);
  const valueOf = (v) => (state.mode === "index" ? v.index : v.count);

  const { svg, g, width, height } = G29.makeSvg("#chart-groups", {
    height: 400, margin: { top: 30, right: 20, bottom: 40, left: 64 },
  });
  svg.attr("aria-label", `Line chart of hospitalisations by ${GROUP_LABELS[state.groupType]}, 2011 to 2021, ` +
    `shown as ${state.mode === "index" ? "an index where 2011 equals 100" : "counts"}. ` +
    `${story.name} grew fastest, up ${Math.round(story.growth * 100)}%.`);

  const x = d3.scaleLinear().domain([2011, 2021]).range([0, width]);
  const allValues = series.flatMap((s) => s.values.map(valueOf));
  const y = state.mode === "index"
    ? d3.scaleLinear().domain(d3.extent([...allValues, 100])).nice().range([height, 0])
    : d3.scaleLinear().domain([0, d3.max(allValues)]).nice().range([height, 0]);

  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(""));
  g.append("g").attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(width < 500 ? 6 : 11).tickFormat(d3.format("d")));
  g.append("g").call(d3.axisLeft(y).ticks(6).tickFormat(state.mode === "index" ? d3.format("d") : G29.fmt.compact));
  g.append("text").attr("x", -54).attr("y", -14)
    .text(state.mode === "index" ? "Index (2011 = 100)" : "Hospitalisations");

  if (state.mode === "index") {
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(100)).attr("y2", y(100))
      .attr("stroke", "var(--c-text-soft)").attr("stroke-dasharray", "4 4");
  }

  const line = d3.line().x((v) => x(v.Year)).y((v) => y(valueOf(v)));
  const colourOf = (s) => {
    if (state.selected) return s.name === state.selected ? G29.colours.main : G29.colours.muted;
    return s.name === story.name ? G29.colours.highlight : G29.colours.muted;
  };
  const isActive = (s) => (state.selected ? s.name === state.selected : s.name === story.name);

  const lines = g.append("g").selectAll("path")
    .data(series)
    .join("path")
    .attr("fill", "none")
    .attr("d", (s) => line(s.values))
    .attr("stroke", colourOf)
    .attr("stroke-width", (s) => (isActive(s) ? 3.5 : 1.5))
    .attr("opacity", (s) => (isActive(s) ? 1 : 0.6));
  lines.filter(isActive).raise();

  // Wide invisible lines make thin lines easy to hover
  g.append("g").selectAll("path")
    .data(series)
    .join("path")
    .attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 14)
    .attr("d", (s) => line(s.values))
    .style("cursor", "pointer")
    .on("mouseenter", (event, s) => preview(s.name))
    .on("mousemove", (event, s) => {
      const yr = Math.round(x.invert(d3.pointer(event, g.node())[0]));
      const v = s.values.find((o) => o.Year === yr) || s.values[s.values.length - 1];
      G29.tooltip.show(event, `<strong>${s.name}, ${v.Year}</strong><br>${G29.fmt.number(v.count)} hospitalisations` +
        `<br>Index ${Math.round(v.index)} (2011 = 100)`);
    })
    .on("mouseleave", () => { G29.tooltip.hide(); preview(null); })
    .on("click", (event, s) => select(s.name));

  // Label the active line at its end, in text, so colour is not the only cue
  const active = series.find(isActive);
  const lastV = active.values[active.values.length - 1];
  g.append("text").attr("class", "annotation")
    .attr("x", x(2021)).attr("y", y(valueOf(lastV)) - 10).attr("text-anchor", "end")
    .style("fill", colourOf(active))
    .text(`${active.name}: ${state.mode === "index" ? Math.round(lastV.index) : G29.fmt.number(lastV.count)}`);

  // Hovering shows a line in blue without changing the chosen one
  function preview(name) {
    lines.attr("stroke", (s) => {
      if (name) return s.name === name ? G29.colours.main : G29.colours.muted;
      return colourOf(s);
    })
      .attr("stroke-width", (s) => ((name ? s.name === name : isActive(s)) ? 3.5 : 1.5))
      .attr("opacity", (s) => ((name ? s.name === name : isActive(s)) ? 1 : name ? 0.35 : 0.6));
    if (name) lines.filter((s) => s.name === name).raise();
  }

  function select(name) {
    state.selected = state.selected === name ? null : name;
    drawGroups(all);
  }

  // Legend buttons: keyboard and touch users can pick a line here
  const legend = d3.select("#chart-groups-legend").html("");
  legend.selectAll("li").data(series).join("li").append("button")
    .attr("type", "button")
    .attr("aria-pressed", (s) => s.name === state.selected)
    .on("click", (event, s) => select(s.name))
    .on("mouseenter focus", (event, s) => preview(s.name))
    .on("mouseleave blur", () => preview(null))
    .html((s) => `<span class="swatch" style="background:${colourOf(s)}"></span>${s.name}`);

  // One-sentence finding that updates with the dropdown
  const focus = active;
  const pct = Math.round(focus.growth * 100);
  const peak = d3.greatest(focus.values, (v) => v.count);
  let text = `${focus.name}: ${G29.fmt.number(focus.base)} in 2011 to ${G29.fmt.number(focus.last)} in 2021 ` +
    `(${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}%), against +16% for all hospitalisations.`;
  if (peak.Year !== 2021) text += ` It peaked in ${peak.Year} at ${G29.fmt.number(peak.count)}.`;
  if (focus === story && !state.selected) text = `Fastest growing ${GROUP_LABELS[state.groupType]}: ${text}`;
  d3.select("#chart-groups-finding").text(text);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Button toggle (only one active), e.g. Hospitalisations / Bed days.
   Kept in this page file because common.js is shared and not edited. */
function makeToggle(selector, options, onChange, ariaLabel = "Choose measure") {
  const group = d3.select(selector).append("div").attr("class", "toggle").attr("role", "group").attr("aria-label", ariaLabel);
  const buttons = group.selectAll("button")
    .data(options)
    .join("button")
    .attr("type", "button")
    .attr("aria-pressed", (d, i) => i === 0)
    .text((d) => d.label);
  buttons.on("click", (event, d) => {
    buttons.attr("aria-pressed", (o) => o.value === d.value);
    onChange(d.value);
  });
  return group;
}

// Respect the "reduce motion" system setting
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
