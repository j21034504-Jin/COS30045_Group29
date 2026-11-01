/*
 * home.js — Home page: KPI tiles and the headline line chart.
 * Owner: Soon Mung Hing
 * Data: data/yearly_total.csv (Year, Hospitalisations, bed_days, avg_stay_days)
 * GenAI note: written with help from Claude (Anthropic) and reviewed by Group 29.
 */

(async function init() {
  const data = await G29.loadCSV("yearly_total", "#chart-headline");
  if (!data.length) return;
  data.sort((a, b) => a.Year - b.Year);

  drawKpis(data);
  drawHeadline(data, "Hospitalisations");

  makeToggle("#chart-headline-controls", [
    { value: "Hospitalisations", label: "Hospitalisations" },
    { value: "bed_days", label: "Bed days" },
  ], (measure) => drawHeadline(data, measure));

  // Redraw on resize so the SVG fits phone and desktop widths
  let current = "Hospitalisations";
  d3.selectAll("#chart-headline-controls button").on("click.track", (e, d) => { current = d.value; });
  window.addEventListener("resize", debounce(() => drawHeadline(data, current), 200));
})();

/* ---------- KPI tiles ---------- */
function drawKpis(data) {
  const totalHosp = d3.sum(data, (d) => d.Hospitalisations);
  const totalBed = d3.sum(data, (d) => d.bed_days);
  const first = data[0];
  const last = data[data.length - 1];
  const avgStay = totalBed / totalHosp; // whole-decade average, not a mean of the yearly averages
  const change = last.Hospitalisations / first.Hospitalisations - 1;

  const tiles = [
    { id: "#kpi-hosp", value: totalHosp, format: d3.format(",.0f") },          // 410,884
    { id: "#kpi-beddays", value: totalBed / 1e6, format: (v) => `${v.toFixed(2)}M` }, // 2.01M
    { id: "#kpi-stay", value: avgStay, format: (v) => v.toFixed(1) },           // 4.9
    { id: "#kpi-change", value: change * 100, format: (v) => `+${Math.round(v)}%` }, // +16%
  ];

  tiles.forEach((t) => {
    const el = d3.select(t.id);
    // Screen readers get the final value straight away, even while the number counts up
    el.attr("aria-label", t.format(t.value));
    if (REDUCED_MOTION) { el.text(t.format(t.value)); return; }
    el.transition().duration(1400).ease(d3.easeCubicOut)
      .tween("text", () => {
        const i = d3.interpolateNumber(0, t.value);
        return (p) => el.text(t.format(i(p)));
      });
  });
}

/* ---------- Headline line chart ---------- */
function drawHeadline(data, measure) {
  const isBed = measure === "bed_days";
  const label = isBed ? "bed days" : "hospitalisations";
  const { svg, g, width, height } = G29.makeSvg("#chart-headline", {
    height: 380, margin: { top: 40, right: 30, bottom: 40, left: 70 },
  });
  svg.attr("aria-label", `Line chart of ${label} per year from 2011 to 2021. ` +
    (isBed ? "Bed days jump in 2015 and 2016 after a change in how rehabilitation is coded."
           : "Hospitalisations rise from 34,033 in 2011 to 39,505 in 2021, with a dip to 37,966 in 2020."));

  const x = d3.scaleLinear().domain(d3.extent(data, (d) => d.Year)).range([0, width]);
  // y starts at zero so the size of the rise is not exaggerated
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d[measure]) * 1.1]).nice().range([height, 0]);

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""));
  g.append("g").attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format("d")));
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(G29.fmt.compact));
  g.append("text").attr("x", -60).attr("y", -20).text(isBed ? "Bed days" : "Hospitalisations");

  // Bed-days series break: the 2015–16 coding change (see About page)
  if (isBed) {
    const bx = x(2014.5);
    g.append("line").attr("x1", bx).attr("x2", bx).attr("y1", 0).attr("y2", height)
      .attr("stroke", G29.colours.muted).attr("stroke-dasharray", "4 4");
    g.append("text").attr("x", bx + 6).attr("y", 12).text("Coding change from 2015–16");
  }

  const line = d3.line().x((d) => x(d.Year)).y((d) => y(d[measure])).curve(d3.curveMonotoneX);
  const path = g.append("path").datum(data)
    .attr("fill", "none").attr("stroke", G29.colours.main).attr("stroke-width", 3).attr("d", line);

  // Draw the line from left to right on first view
  if (!REDUCED_MOTION) {
    const len = path.node().getTotalLength();
    path.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
      .transition().duration(1000).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
      .on("end", () => path.attr("stroke-dasharray", null));
  }

  g.selectAll("circle")
    .data(data)
    .join("circle")
    .attr("cx", (d) => x(d.Year))
    .attr("cy", (d) => y(d[measure]))
    .attr("r", (d) => (d.Year === 2020 ? 7 : 5))
    .attr("fill", (d) => (d.Year === 2020 ? G29.colours.highlight : G29.colours.main))
    .attr("stroke", "var(--c-surface)").attr("stroke-width", 2)
    .on("mouseenter", (event, d) => {
      d3.select(event.currentTarget).attr("r", 8);
      G29.tooltip.show(event, `<strong>${d.Year}</strong><br>${G29.fmt.number(d.Hospitalisations)} hospitalisations` +
        `<br>${G29.fmt.number(d.bed_days)} bed days<br>${d.avg_stay_days} days average stay`);
    })
    .on("mousemove", (event) => G29.tooltip.move(event))
    .on("mouseleave", (event, d) => {
      d3.select(event.currentTarget).attr("r", d.Year === 2020 ? 7 : 5);
      G29.tooltip.hide();
    });

  // Label the 2020 story point in text as well as colour (colour-blind readers)
  const p2020 = data.find((d) => d.Year === 2020);
  if (p2020) {
    g.append("text").attr("class", "annotation")
      .attr("x", x(2020) + 12).attr("y", y(p2020[measure]) + 28).attr("text-anchor", "end")
      .style("fill", G29.colours.highlight)
      .text(`2020 dip, COVID-19 year (${G29.fmt.number(p2020[measure])})`);
  }

  d3.select("#chart-headline-note").text(isBed
    ? "Bed days before and after 2015–16 are not directly comparable: rehabilitation stays began to be coded differently that year."
    : "Counts of people admitted to hospital, excluding those who died. Hover a point for the exact numbers.");
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
