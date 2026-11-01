// Who page: age and sex pyramid, length of stay by age, and First Nations growth and remoteness.
// Written with help from Claude (Anthropic) AI and reviewed by Group 29. Patterns follow the D3 v7 docs (d3js.org).
(async function () {
  const { colours, fmt, loadCSV, tooltip, addCaveat, yearSelect, makeSvg, CAVEAT_COUNTS } = G29;

  const [ageRows, fnRows] = await Promise.all([
    loadCSV("who_age_sex", "#chart-pyramid"),
    loadCSV("who_first_nations", "#chart-fn-trend"),
  ]);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = reduceMotion ? 0 : 600;
  const SEX_COLOUR = { Male: colours.main, Female: colours.categories[1] }; // blue and orange: colour-blind safe pair
  const SEX_NAME = { Male: "Men", Female: "Women" };
  const dash = (s) => String(s).replace("-", "–"); // "17-25" -> "17–25" for display
  const yearText = (y) => (y == null ? "2011–2021" : y);
  const days = d3.format(".1f");

  /* ---------------- Shared helpers for this page ---------------- */

  // Pill toggle, same look as the Where page. Calls onPick(value).
  function segmented(selector, label, options, current, onPick) {
    const seg = d3.select(selector).append("div").attr("class", "seg").attr("role", "group").attr("aria-label", label);
    seg.selectAll("button")
      .data(options)
      .join("button")
      .attr("type", "button")
      .attr("aria-pressed", (d) => d.value === current)
      .text((d) => d.label)
      .on("click", (event, d) => {
        seg.selectAll("button").attr("aria-pressed", (o) => o.value === d.value);
        onPick(d.value);
      });
  }

  // Tooltip on hover and on keyboard focus, plus a matching aria-label for screen readers.
  function bindTip(selection, html) {
    selection
      .attr("tabindex", 0)
      .attr("aria-label", (d) => html(d).replace(/<br>/g, ". ").replace(/<[^>]+>/g, ""))
      .on("mousemove", (event, d) => tooltip.show(event, html(d)))
      .on("mouseleave", () => tooltip.hide())
      .on("focus", function (event, d) {
        const box = this.getBoundingClientRect();
        tooltip.show({ clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }, html(d));
      })
      .on("blur", () => tooltip.hide());
  }

  const isDark = (c) => d3.hsl(c).l < 0.5;
  const widthOf = (selector) => document.querySelector(selector).getBoundingClientRect().width || 600;

  /* ================= Age and sex ================= */
  const AGES = Array.from(d3.rollup(ageRows, (v) => v[0].age_order, (d) => d.age_group))
    .sort((a, b) => a[1] - b[1])
    .map((d) => d[0]);
  const years = Array.from(new Set(ageRows.map((d) => d.Year))).sort(d3.ascending);

  // Sum hospitalisations and bed days by age and sex for one year, or all years when year is null.
  function ageSex(year, sex = null) {
    const rows = ageRows.filter((d) => (year == null || d.Year === year) && (sex == null || d.Sex === sex));
    return d3.rollups(
      rows,
      (v) => ({ Hospitalisations: d3.sum(v, (d) => d.Hospitalisations), bed_days: d3.sum(v, (d) => d.bed_days) }),
      (d) => d.age_group,
      (d) => d.Sex,
    ).flatMap(([age_group, bySex]) => bySex.map(([Sex, v]) => ({ age_group, Sex, ...v })));
  }

  const pyramid = { year: null, measure: "Hospitalisations" };
  const MEASURE_NAME = { Hospitalisations: "hospitalisations", bed_days: "bed days" };

  if (ageRows.length) {
    yearSelect("#chart-pyramid-controls", years, (y) => { pyramid.year = y; drawPyramid(); });
    segmented("#chart-pyramid-controls", "Pyramid measure", [
      { value: "Hospitalisations", label: "Hospitalisations" },
      { value: "bed_days", label: "Bed days" },
    ], pyramid.measure, (v) => { pyramid.measure = v; drawPyramid(); });
    addCaveat("#chart-pyramid-note", "Bed days are the total days spent in hospital. People who died within 30 days are not included.");
  }

  function drawPyramid() {
    const side = widthOf("#chart-pyramid") < 520 ? 34 : 52;
    const { svg, g, width, height } = makeSvg("#chart-pyramid", { height: 400, margin: { top: 44, right: side, bottom: 32, left: side } });
    const m = pyramid.measure;
    svg.attr("role", "group").attr("aria-label", `Population pyramid of road crash ${MEASURE_NAME[m]} by age and sex, ${yearText(pyramid.year)}`);

    const data = ageSex(pyramid.year);
    // Single years share one scale so switching years shows real change; "All years" uses its own.
    const max = pyramid.year == null ? d3.max(data, (d) => d[m]) : d3.max(ageRows, (d) => d[m]);
    const gap = 64;
    const half = (width - gap) / 2;
    const xMale = d3.scaleLinear([0, max], [half, 0]).nice();
    const xFemale = d3.scaleLinear([0, max], [half + gap, width]).nice();
    const y = d3.scaleBand(AGES.slice().reverse(), [0, height]).padding(0.18);
    const ticks = width < 480 ? 2 : 4;

    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xMale).ticks(ticks).tickFormat(fmt.compact));
    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xFemale).ticks(ticks).tickFormat(fmt.compact));

    // Side titles with each sex's share of the total
    const total = d3.sum(data, (d) => d[m]);
    const share = (sex) => fmt.percent(d3.sum(data.filter((d) => d.Sex === sex), (d) => d[m]) / total);
    g.append("text").attr("class", "side-title").attr("x", half).attr("y", -18).attr("text-anchor", "end")
      .style("fill", SEX_COLOUR.Male).text(`Men · ${share("Male")}`);
    g.append("text").attr("class", "side-title").attr("x", half + gap).attr("y", -18)
      .style("fill", SEX_COLOUR.Female).text(`Women · ${share("Female")}`);

    g.append("g").selectAll("text").data(AGES).join("text")
      .attr("class", "age-label").attr("x", half + gap / 2).attr("y", (a) => y(a) + y.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "middle").text(dash);

    const isMale = (d) => d.Sex === "Male";
    const barX = (d) => (isMale(d) ? xMale(d[m]) : half + gap);
    const barW = (d) => (isMale(d) ? half - xMale(d[m]) : xFemale(d[m]) - (half + gap));

    const bars = g.append("g").selectAll("rect").data(data).join("rect")
      .attr("class", "bar")
      .attr("y", (d) => y(d.age_group))
      .attr("height", y.bandwidth())
      .attr("rx", 4)
      .attr("fill", (d) => SEX_COLOUR[d.Sex])
      .attr("x", (d) => (isMale(d) ? half : half + gap))
      .attr("width", 0);
    bars.transition().duration(DURATION).attr("x", barX).attr("width", barW);

    bindTip(bars, (d) =>
      `<strong>${SEX_NAME[d.Sex]} aged ${dash(d.age_group)}, ${yearText(pyramid.year)}</strong><br>` +
      `${fmt.number(d.Hospitalisations)} hospitalisations<br>${fmt.number(d.bed_days)} bed days<br>` +
      `Average stay ${days(d.bed_days / d.Hospitalisations)} days`);

    g.append("g").selectAll("text").data(data).join("text")
      .attr("class", "value")
      .attr("x", (d) => (isMale(d) ? xMale(d[m]) - 4 : xFemale(d[m]) + 4))
      .attr("y", (d) => y(d.age_group) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (d) => (isMale(d) ? "end" : "start"))
      .text((d) => fmt.compact(d[m]));
  }

  /* ================= Length of stay ================= */
  const stay = { year: null, sex: null };

  if (ageRows.length) {
    yearSelect("#chart-stay-controls", years, (y) => { stay.year = y; drawStay(); });
    segmented("#chart-stay-controls", "Sex", [
      { value: null, label: "All" },
      { value: "Male", label: "Men" },
      { value: "Female", label: "Women" },
    ], stay.sex, (v) => { stay.sex = v; drawStay(); });
    addCaveat("#chart-stay-note", "Average stay = bed days ÷ hospitalisations for each age group.");
  }

  function drawStay() {
    const { svg, g, width, height } = makeSvg("#chart-stay", { height: 340, margin: { top: 30, right: 12, bottom: 36, left: 44 } });
    const sexText = stay.sex ? SEX_NAME[stay.sex].toLowerCase() : "everyone";
    svg.attr("role", "group").attr("aria-label", `Bar chart of average days in hospital by age group for ${sexText}, ${yearText(stay.year)}`);

    const rows = d3.rollups(ageSex(stay.year, stay.sex), (v) => ({
      Hospitalisations: d3.sum(v, (d) => d.Hospitalisations),
      bed_days: d3.sum(v, (d) => d.bed_days),
    }), (d) => d.age_group).map(([age_group, v]) => ({ age_group, ...v, avg: v.bed_days / v.Hospitalisations }));
    const overall = d3.sum(rows, (d) => d.bed_days) / d3.sum(rows, (d) => d.Hospitalisations);
    const top = d3.greatest(rows, (d) => d.avg);

    const x = d3.scaleBand(AGES, [0, width]).padding(0.22);
    const y = d3.scaleLinear([0, Math.max(12, d3.max(rows, (d) => d.avg))], [height, 0]).nice();

    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickFormat(dash));
    g.append("g").call(d3.axisLeft(y).ticks(6));
    g.append("text").attr("x", -36).attr("y", -14).text("Average days in hospital");

    const bars = g.append("g").selectAll("rect").data(rows).join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.age_group))
      .attr("width", x.bandwidth())
      .attr("rx", 4)
      .attr("fill", (d) => (d === top ? colours.highlight : colours.muted))
      .attr("y", height)
      .attr("height", 0);
    bars.transition().duration(DURATION).attr("y", (d) => y(d.avg)).attr("height", (d) => height - y(d.avg));

    bindTip(bars, (d) =>
      `<strong>Aged ${dash(d.age_group)}, ${yearText(stay.year)}</strong><br>Average stay ${days(d.avg)} days<br>` +
      `${fmt.number(d.Hospitalisations)} hospitalisations<br>${fmt.number(d.bed_days)} bed days`);

    g.append("g").selectAll("text").data(rows).join("text")
      .attr("class", "value")
      .attr("x", (d) => x(d.age_group) + x.bandwidth() / 2)
      .attr("y", (d) => y(d.avg) - 6)
      .attr("text-anchor", "middle")
      .style("fill", (d) => (d === top ? colours.highlight : null))
      .text((d) => days(d.avg));

    // Average across all ages, for reference
    g.append("line").attr("class", "note-line").attr("x1", 0).attr("x2", width).attr("y1", y(overall)).attr("y2", y(overall));
    g.append("text").attr("class", "note").attr("x", 4).attr("y", y(overall) - 6)
      .text(`All ages: ${days(overall)} days`);
  }

  /* ================= First Nations growth ================= */
  const AREAS = ["Major Cities", "Regional", "Remote"];
  const GROUPS = ["First Nations people", "Non-Indigenous"];
  const GROUP_COLOUR = { "First Nations people": colours.highlight, "Non-Indigenous": colours.muted };
  const GROUP_SHORT = { "First Nations people": "First Nations", "Non-Indigenous": "Non-Indigenous" };
  const fnYears = Array.from(new Set(fnRows.map((d) => d.Year))).sort(d3.ascending);
  const FIRST = fnYears[0];
  const LAST = fnYears[fnYears.length - 1];
  const fnTrend = { area: null };

  if (fnRows.length) {
    segmented("#chart-fn-trend-controls", "Remoteness area", [
      { value: null, label: "All areas" },
      ...AREAS.map((a) => ({ value: a, label: a })),
    ], fnTrend.area, (v) => { fnTrend.area = v; drawFnTrend(); });
    addCaveat("#chart-fn-trend-note", `${CAVEAT_COUNTS} Each group's ${FIRST} count is set to 100 so both lines start together.`);
  }

  function drawFnTrend() {
    const { svg, g, width, height } = makeSvg("#chart-fn-trend", { height: 340, margin: { top: 30, right: 104, bottom: 36, left: 44 } });
    const areaText = fnTrend.area ?? "all areas";
    svg.attr("role", "group").attr("aria-label", `Line chart of hospitalisation growth for First Nations and non-Indigenous people in ${areaText}, ${FIRST} to ${LAST}`);

    const rows = fnRows.filter((d) => fnTrend.area == null || d.remoteness === fnTrend.area);
    const series = GROUPS.map((group) => {
      const byYear = d3.rollups(rows.filter((d) => d.fn_status === group), (v) => d3.sum(v, (d) => d.Hospitalisations), (d) => d.Year)
        .sort((a, b) => a[0] - b[0]);
      const base = byYear[0][1];
      return { group, values: byYear.map(([Year, count]) => ({ group, Year, count, index: (count / base) * 100 })) };
    });
    const all = series.flatMap((s) => s.values);

    const x = d3.scaleLinear([FIRST, LAST], [0, width]);
    const y = d3.scaleLinear([Math.min(80, d3.min(all, (d) => d.index)), Math.max(120, d3.max(all, (d) => d.index))], [height, 0]).nice();
    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(width < 420 ? 4 : 6).tickFormat(d3.format("d")));
    g.append("g").call(d3.axisLeft(y).ticks(6));
    g.append("text").attr("x", -36).attr("y", -14).text(`Hospitalisations, ${FIRST} = 100`);
    g.append("line").attr("class", "note-line").attr("x1", 0).attr("x2", width).attr("y1", y(100)).attr("y2", y(100));

    const line = d3.line().x((d) => x(d.Year)).y((d) => y(d.index));
    // Draw non-Indigenous first so the First Nations line sits on top
    for (const s of series.slice().reverse()) {
      const colour = GROUP_COLOUR[s.group];
      const path = g.append("path").datum(s.values).attr("fill", "none").attr("stroke", colour)
        .attr("stroke-width", s.group === GROUPS[0] ? 3 : 2).attr("d", line);
      if (!reduceMotion) {
        const len = path.node().getTotalLength();
        path.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len).transition().duration(700).attr("stroke-dashoffset", 0);
      }
      const dots = g.append("g").selectAll("circle").data(s.values).join("circle")
        .attr("class", "bar").attr("cx", (d) => x(d.Year)).attr("cy", (d) => y(d.index)).attr("r", 4).attr("fill", colour);
      bindTip(dots, (d) =>
        `<strong>${d.group}, ${d.Year}</strong><br>${fmt.number(d.count)} hospitalisations<br>Index ${Math.round(d.index)} (${FIRST} = 100)`);
    }

    // End labels, nudged apart if the lines finish close together
    const ends = series.map((s) => {
      const last = s.values[s.values.length - 1];
      return { group: s.group, y: y(last.index), change: last.index / 100 - 1 };
    }).sort((a, b) => a.y - b.y);
    if (ends[1].y - ends[0].y < 32) {
      const mid = (ends[0].y + ends[1].y) / 2;
      ends[0].y = mid - 16;
      ends[1].y = mid + 16;
    }
    for (const e of ends) {
      const colour = GROUP_COLOUR[e.group];
      g.append("text").attr("class", "end-label").attr("x", width + 8).attr("y", e.y - 7).attr("dy", "0.35em")
        .style("fill", colour).text(GROUP_SHORT[e.group]);
      g.append("text").attr("class", "end-label").attr("x", width + 8).attr("y", e.y + 8).attr("dy", "0.35em")
        .style("fill", colour).text(`${e.change > 0 ? "+" : ""}${fmt.percent(e.change)}`);
    }
  }

  /* ================= Where each group lives ================= */
  const AREA_COLOUR = { "Major Cities": colours.sequential(0.12), Regional: colours.sequential(0.55), Remote: colours.sequential(0.95) };
  const fnArea = { year: null };

  if (fnRows.length) {
    yearSelect("#chart-fn-area-controls", fnYears, (y) => { fnArea.year = y; drawFnArea(); });
    d3.select("#chart-fn-area-controls").append("div").attr("class", "legend").attr("aria-hidden", "true")
      .selectAll("span").data(AREAS).join("span")
      .style("--swatch", (a) => AREA_COLOUR[a])
      .text((a) => a);
    addCaveat("#chart-fn-area-note", `${CAVEAT_COUNTS} Each bar shows shares within its own group, so the bars compare where people live, not how many were hurt.`);
  }

  function drawFnArea() {
    const { svg, g, width, height } = makeSvg("#chart-fn-area", { height: 320, margin: { top: 36, right: 22, bottom: 32, left: 12 } });
    svg.attr("role", "group").attr("aria-label", `Stacked bar chart of the share of hospitalisations by remoteness area for First Nations and non-Indigenous people, ${yearText(fnArea.year)}`);

    const rows = fnRows.filter((d) => fnArea.year == null || d.Year === fnArea.year);
    const segments = GROUPS.flatMap((group) => {
      const counts = AREAS.map((area) => d3.sum(rows.filter((d) => d.fn_status === group && d.remoteness === area), (d) => d.Hospitalisations));
      const total = d3.sum(counts);
      let start = 0;
      return AREAS.map((area, i) => {
        const seg = { group, area, count: counts[i], share: counts[i] / total, start };
        start += seg.share;
        return seg;
      });
    });

    const x = d3.scaleLinear([0, 1], [0, width]);
    const y = d3.scaleBand(GROUPS, [0, height]).paddingInner(0.55).paddingOuter(0.1);
    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(fmt.percent));

    g.append("g").selectAll("text").data(GROUPS).join("text")
      .attr("class", "row-label").attr("x", 0).attr("y", (gr) => y(gr) - 8).text((gr) => gr);

    const bars = g.append("g").selectAll("rect").data(segments).join("rect")
      .attr("class", "bar")
      .attr("y", (d) => y(d.group))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => AREA_COLOUR[d.area])
      .attr("x", 0)
      .attr("width", 0);
    bars.transition().duration(DURATION).attr("x", (d) => x(d.start)).attr("width", (d) => Math.max(0, x(d.share) - 1));

    bindTip(bars, (d) =>
      `<strong>${d.group}, ${d.area}, ${yearText(fnArea.year)}</strong><br>${fmt.number(d.count)} hospitalisations<br>` +
      `${fmt.percent(d.share)} of ${GROUP_SHORT[d.group]} hospitalisations`);

    g.append("g").selectAll("text").data(segments.filter((d) => x(d.share) > 40)).join("text")
      .attr("class", "seg-label")
      .attr("x", (d) => x(d.start) + 8)
      .attr("y", (d) => y(d.group) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .style("fill", (d) => (isDark(AREA_COLOUR[d.area]) ? "#fff" : "#000"))
      .text((d) => fmt.percent(d.share));
  }

  /* ---------------- Draw and redraw on resize ---------------- */
  function drawAll() {
    if (ageRows.length) { drawPyramid(); drawStay(); }
    if (fnRows.length) { drawFnTrend(); drawFnArea(); }
  }
  drawAll();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAll, 200);
  });
})();
