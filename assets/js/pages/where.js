(async function () {
  const { colours, fmt, loadCSV, tooltip, CAVEAT_COUNTS } = G29;

  // Caveat paragraph placed just below a chart (outside the chart div, so redraws keep it in place).
  function caveatAfter(selector, text) {
    const p = document.createElement("p");
    p.className = "caveat";
    p.textContent = text;
    document.querySelector(selector).after(p);
  }

  const [stateRows, remoteRows, geo] = await Promise.all([
    loadCSV("where_state", "#chart-map"),
    loadCSV("where_remoteness", "#chart-remoteness"),
    d3.json("data/aus_states.geojson").catch(() => null),
  ]);
  if (!stateRows.length || !geo) {
    d3.select("#chart-map").text("Sorry, the map could not be loaded.");
    return;
  }

  const years = d3.range(2011, 2022);
  const FIRST = 2011;
  const LAST = 2021;
  const STATE_NAMES = { ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", Qld: "Queensland", SA: "South Australia", Tas: "Tasmania", Vic: "Victoria", WA: "Western Australia" };

  // Known breaks in the series (BITRE data dictionary, 2023): shown on the trend chart and in the tooltip.
  const BREAKS = {
    NSW: { year: 2017, text: "2017: NSW stopped counting ED-only stays as admissions" },
    Vic: { year: 2012, text: "2012: Vic stopped counting ED-only stays as admissions" },
  };

  // Lookup: state -> year -> row, plus change since 2011
  const byState = d3.group(stateRows, (d) => d.state);
  const lookup = new Map();
  for (const [state, rows] of byState) {
    const base = rows.find((r) => r.Year === FIRST).Hospitalisations;
    const m = new Map();
    rows.forEach((r) => m.set(r.Year, { ...r, change: r.Hospitalisations / base - 1 }));
    lookup.set(state, m);
  }

  const state = { measure: "change", year: LAST, selected: "Qld", playing: null };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Map controls ---------------- */
  const mapControls = d3.select("#chart-map-controls");

  function segmented(container, label, options, current, onPick) {
    const seg = container.append("div").attr("class", "seg").attr("role", "group").attr("aria-label", label);
    seg.selectAll("button")
      .data(options)
      .join("button")
      .attr("type", "button")
      .attr("aria-pressed", (d) => d.value === current)
      .text((d) => d.label)
      .on("click", function (event, d) {
        seg.selectAll("button").attr("aria-pressed", (o) => o.value === d.value);
        onPick(d.value);
      });
  }

  segmented(mapControls, "Map measure", [
    { value: "change", label: "Change since 2011" },
    { value: "count", label: "Count" },
  ], state.measure, (v) => { state.measure = v; drawMap(); });

  const playBtn = mapControls.append("button").attr("type", "button").attr("class", "play").text("▶ Play");
  mapControls.append("label").attr("for", "year-slider").attr("class", "sr-only").text("Year");
  const slider = mapControls.append("input")
    .attr("type", "range").attr("id", "year-slider")
    .attr("min", FIRST).attr("max", LAST).attr("step", 1)
    .property("value", state.year)
    .on("input", (event) => { stopPlay(); state.year = +event.target.value; drawMap(); });
  const yearNow = mapControls.append("span").attr("class", "year-now").attr("aria-live", "polite").text(state.year);

  function stopPlay() {
    if (state.playing) clearInterval(state.playing);
    state.playing = null;
    playBtn.text("▶ Play");
  }
  playBtn.on("click", () => {
    if (state.playing) return stopPlay();
    if (state.year === LAST) state.year = FIRST;
    playBtn.text("❚❚ Pause");
    drawMap();
    state.playing = setInterval(() => {
      if (state.year >= LAST) return stopPlay();
      state.year += 1;
      drawMap();
    }, reduceMotion ? 1400 : 1000);
  });

  /* ---------------- Map ---------------- */
  const mapEl = d3.select("#chart-map");
  const maxAbsChange = d3.max(stateRows, (d) => Math.abs(lookup.get(d.state).get(d.Year).change));
  const maxCount = d3.max(stateRows, (d) => d.Hospitalisations);
  // Diverging purple-orange for change (colour-blind safe): falls purple, rises orange, cividis for counts (template's sequential scale).
  const changeScale = d3.scaleDiverging([-maxAbsChange, 0, maxAbsChange], d3.interpolatePuOr);
  const countScale = d3.scaleSequential([0, maxCount], colours.sequential);
  const fillFor = (d) => (state.measure === "change" ? changeScale(d.change) : countScale(d.Hospitalisations));
  const isDark = (c) => d3.hsl(c).l < 0.5;

  let mapSvg, statePaths, labels, legendG, path;

  function buildMap() {
    mapEl.selectAll("svg").remove();
    const width = mapEl.node().getBoundingClientRect().width || 500;
    const height = Math.round(width * 0.78);
    mapSvg = mapEl.append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("role", "group")
      .attr("aria-label", "Map of Australia's states and territories, coloured by hospitalisations");
    const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 64]], geo);
    path = d3.geoPath(projection);

    statePaths = mapSvg.append("g").selectAll("path")
      .data(geo.features)
      .join("path")
      .attr("class", "state")
      .attr("d", path)
      .attr("tabindex", 0)
      .attr("role", "button")
      .on("mousemove", (event, f) => tooltip.show(event, tipHtml(f.properties.state)))
      .on("mouseleave", () => tooltip.hide())
      .on("focus", function (event, f) {
        const box = this.getBoundingClientRect();
        tooltip.show({ clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }, tipHtml(f.properties.state));
      })
      .on("blur", () => tooltip.hide())
      .on("click", (event, f) => selectState(f.properties.state))
      .on("keydown", (event, f) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectState(f.properties.state); }
      });

    // Labels: ACT is tiny, so its label sits off the coast with a leader line.
    const labelPos = (f) => {
      const [x, y] = path.centroid(f);
      return f.properties.state === "ACT" ? [x + 34, y + 6] : f.properties.state === "Vic" ? [x, y + 4] : [x, y];
    };
    const act = geo.features.find((f) => f.properties.state === "ACT");
    const [ax, ay] = path.centroid(act);
    mapSvg.append("line").attr("class", "note-line").attr("x1", ax).attr("y1", ay).attr("x2", ax + 24).attr("y2", ay + 3);
    labels = mapSvg.append("g").selectAll("text")
      .data(geo.features)
      .join("text")
      .attr("class", "map-label")
      .attr("text-anchor", (f) => (f.properties.state === "ACT" ? "start" : "middle"))
      .attr("x", (f) => labelPos(f)[0] - (f.properties.state === "ACT" ? 6 : 0))
      .attr("y", (f) => labelPos(f)[1])
      .attr("dy", "0.35em")
      .text((f) => f.properties.state);

    legendG = mapSvg.append("g").attr("transform", `translate(${Math.max(10, width / 2 - 130)},${height - 48})`);
    drawMap();
  }

  function drawMap() {
    slider.property("value", state.year);
    yearNow.text(state.year);
    const t = mapSvg.transition().duration(reduceMotion ? 0 : 400);
    statePaths
      .classed("selected", (f) => f.properties.state === state.selected)
      .attr("aria-pressed", (f) => f.properties.state === state.selected)
      .attr("aria-label", (f) => ariaFor(f.properties.state))
      .transition(t)
      .attr("fill", (f) => fillFor(lookup.get(f.properties.state).get(state.year)));
    labels.classed("light", (f) => {
      if (f.properties.state === "ACT") return true; // ACT label sits on the dark background
      return isDark(fillFor(lookup.get(f.properties.state).get(state.year)));
    });
    // Keep the selected outline on top
    statePaths.filter((f) => f.properties.state === state.selected).raise();
    drawLegend();
  }

  function drawLegend() {
    legendG.selectAll("*").remove();
    const w = 260;
    const scale = state.measure === "change" ? changeScale : countScale;
    const [lo, hi] = state.measure === "change" ? [-maxAbsChange, maxAbsChange] : [0, maxCount];
    const id = "legend-grad";
    const grad = legendG.append("defs").append("linearGradient").attr("id", id);
    d3.range(0, 1.01, 0.1).forEach((p) => {
      grad.append("stop").attr("offset", `${p * 100}%`).attr("stop-color", scale(lo + p * (hi - lo)));
    });
    legendG.append("text").attr("class", "legend-title").attr("y", -6)
      .text(state.measure === "change" ? "Change in hospitalisations since 2011" : "Hospitalisations in the year");
    legendG.append("rect").attr("width", w).attr("height", 10).attr("rx", 3).attr("fill", `url(#${id})`);
    const x = d3.scaleLinear([lo, hi], [0, w]);
    const axis = d3.axisBottom(x).ticks(5).tickSize(4)
      .tickFormat(state.measure === "change" ? (v) => (v > 0 ? "+" : "") + fmt.percent(v) : fmt.compact);
    legendG.append("g").attr("transform", "translate(0,10)").call(axis).call((g) => g.select(".domain").remove());
  }

  function tipHtml(code) {
    const d = lookup.get(code).get(state.year);
    const change = state.year === FIRST ? "base year" : `${d.change > 0 ? "+" : ""}${fmt.percent(d.change)} since 2011`;
    const brk = BREAKS[code] && state.year >= BREAKS[code].year ? `<br><em>${BREAKS[code].text}</em>` : "";
    return `<strong>${STATE_NAMES[code]}, ${state.year}</strong><br>${fmt.number(d.Hospitalisations)} hospitalisations<br>${fmt.number(d.bed_days)} bed days<br>${change}${brk}`;
  }
  function ariaFor(code) {
    const d = lookup.get(code).get(state.year);
    return `${STATE_NAMES[code]}, ${state.year}: ${fmt.number(d.Hospitalisations)} hospitalisations, ${d.change >= 0 ? "up" : "down"} ${fmt.percent(Math.abs(d.change))} since 2011. Press Enter to show its trend.`;
  }

  caveatAfter("#chart-map", CAVEAT_COUNTS);

  /* ---------------- State trend ---------------- */
  const trendEl = "#chart-state-trend";

  function selectState(code) {
    state.selected = code;
    drawMap();
    drawTrend();
  }

  function drawTrend() {
    const { svg, g, width, height } = G29.makeSvg(trendEl, { height: 340, margin: { top: 30, right: 56, bottom: 36, left: 56 } });
    const code = state.selected;
    svg.attr("aria-label", `Line chart of ${STATE_NAMES[code]} hospitalisations from 2011 to 2021`);
    const x = d3.scaleLinear([FIRST, LAST], [0, width]);
    const y = d3.scaleLinear([0, d3.max(stateRows, (d) => d.Hospitalisations)], [height, 0]).nice();
    const line = d3.line().x((d) => x(d.Year)).y((d) => y(d.Hospitalisations));

    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
    g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(fmt.compact));
    g.append("text").attr("x", -40).attr("y", -14).text("Hospitalisations a year");

    // Other states in grey for context
    for (const [s, rows] of byState) {
      if (s === code) continue;
      g.append("path").datum(rows).attr("fill", "none").attr("stroke", colours.muted).attr("stroke-width", 1.2).attr("opacity", 0.55).attr("d", line);
    }

    // Series break note
    const brk = BREAKS[code];
    if (brk) {
      g.append("line").attr("class", "note-line").attr("x1", x(brk.year)).attr("x2", x(brk.year)).attr("y1", 0).attr("y2", height);
      g.append("text").attr("class", "note").attr("x", x(brk.year) + 6).attr("y", 12)
        .attr("text-anchor", brk.year > 2016 ? "end" : "start").attr("dx", brk.year > 2016 ? -12 : 0)
        .text(brk.text);
    }

    const rows = byState.get(code);
    const path = g.append("path").datum(rows).attr("fill", "none").attr("stroke", colours.highlight).attr("stroke-width", 3).attr("d", line);
    if (!reduceMotion) {
      const len = path.node().getTotalLength();
      path.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len).transition().duration(700).attr("stroke-dashoffset", 0);
    }

    g.selectAll("circle").data(rows).join("circle")
      .attr("cx", (d) => x(d.Year)).attr("cy", (d) => y(d.Hospitalisations)).attr("r", 4)
      .attr("fill", colours.highlight)
      .on("mousemove", (event, d) => tooltip.show(event, `<strong>${STATE_NAMES[code]}, ${d.Year}</strong><br>${fmt.number(d.Hospitalisations)} hospitalisations`))
      .on("mouseleave", () => tooltip.hide());

    const last = rows.find((d) => d.Year === LAST);
    const change = lookup.get(code).get(LAST).change;
    g.append("text").attr("class", "end-label").attr("x", x(LAST) + 8).attr("y", y(last.Hospitalisations)).attr("dy", "0.35em")
      .attr("fill", colours.highlight).text(code);
    g.append("text").attr("class", "end-label").attr("x", x(LAST) + 8).attr("y", y(last.Hospitalisations) + 15).attr("dy", "0.35em")
      .attr("fill", colours.highlight).text(`${change > 0 ? "+" : ""}${fmt.percent(change)}`);
  }
  caveatAfter(trendEl, "Grey lines are the other states. Counts, not rates.");

  /* ---------------- Remoteness ---------------- */
  const remoteEl = "#chart-remoteness";
  let remoteMode = "index";
  const AREAS = ["Major Cities", "Regional", "Remote"];
  const AREA_COLOUR = { "Major Cities": colours.main, Regional: colours.muted, Remote: colours.highlight };
  const byArea = d3.group(remoteRows, (d) => d.remoteness);
  const remoteBase = new Map(AREAS.map((a) => [a, byArea.get(a).find((d) => d.Year === FIRST).Hospitalisations]));
  const valueOf = (d) => (remoteMode === "index" ? (d.Hospitalisations / remoteBase.get(d.remoteness)) * 100 : d.Hospitalisations);

  segmented(d3.select("#chart-remoteness-controls"), "Remoteness measure", [
    { value: "index", label: "Growth (2011 = 100)" },
    { value: "count", label: "Count" },
  ], remoteMode, (v) => { remoteMode = v; drawRemote(); });

  function drawRemote() {
    const { svg, g, width, height } = G29.makeSvg(remoteEl, { height: 340, margin: { top: 30, right: 110, bottom: 36, left: 60 } });
    svg.attr("aria-label", "Line chart of hospitalisations in Major Cities, Regional and Remote areas, 2011 to 2021");
    const x = d3.scaleLinear([FIRST, LAST], [0, width]);
    const maxV = d3.max(remoteRows, valueOf);
    const y = remoteMode === "index"
      ? d3.scaleLinear([Math.min(80, d3.min(remoteRows, valueOf)), Math.max(130, maxV)], [height, 0]).nice()
      : d3.scaleLinear([0, maxV], [height, 0]).nice();
    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(width < 500 ? 5 : 11).tickFormat(d3.format("d")));
    g.append("g").call(d3.axisLeft(y).ticks(6).tickFormat(remoteMode === "index" ? d3.format("d") : fmt.compact));
    g.append("text").attr("x", -44).attr("y", -14)
      .text(remoteMode === "index" ? "Hospitalisations, 2011 = 100" : "Hospitalisations a year");
    if (remoteMode === "index") {
      g.append("line").attr("class", "note-line").attr("x1", 0).attr("x2", width).attr("y1", y(100)).attr("y2", y(100));
    }
    const line = d3.line().x((d) => x(d.Year)).y((d) => y(valueOf(d)));
    for (const a of AREAS) {
      const rows = byArea.get(a);
      g.append("path").datum(rows).attr("fill", "none").attr("stroke", AREA_COLOUR[a])
        .attr("stroke-width", a === "Regional" ? 2 : 3).attr("d", line);
      g.selectAll(null).data(rows).join("circle")
        .attr("cx", (d) => x(d.Year)).attr("cy", (d) => y(valueOf(d))).attr("r", 3.5).attr("fill", AREA_COLOUR[a])
        .on("mousemove", (event, d) => tooltip.show(event,
          `<strong>${a}, ${d.Year}</strong><br>${fmt.number(d.Hospitalisations)} hospitalisations<br>${fmt.number(d.bed_days)} bed days` +
          (remoteMode === "index" ? `<br>Index ${Math.round(valueOf(d))} (2011 = 100)` : "")))
        .on("mouseleave", () => tooltip.hide());
      const last = rows.find((d) => d.Year === LAST);
      const ch = last.Hospitalisations / remoteBase.get(a) - 1;
      g.append("text").attr("class", "end-label").attr("x", width + 8).attr("y", y(valueOf(last))).attr("dy", "0.35em")
        .attr("fill", AREA_COLOUR[a]).text(`${a} ${ch > 0 ? "+" : ""}${fmt.percent(ch)}`);
    }
  }
  caveatAfter(remoteEl, "Excludes 8,833 hospitalisations with no recorded remoteness. Counts, not rates.");

  /* ---------------- Draw and redraw on resize ---------------- */
  buildMap();
  drawTrend();
  drawRemote();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { buildMap(); drawTrend(); drawRemote(); }, 200);
  });
})();
