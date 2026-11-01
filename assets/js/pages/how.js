// How page: road users ranked, what they collided with, and road user by age.
// Written with help from Claude (Anthropic) AI and reviewed by Group 29. Patterns follow the D3 v7 docs (d3js.org).
(async function () {
  const { colours, fmt, loadCSV, tooltip, addCaveat, yearSelect, makeSvg } = G29;

  const [cpRows, ageRows] = await Promise.all([
    loadCSV("how_user_counterparty", "#chart-users"),
    loadCSV("how_user_age", "#chart-age"),
  ]);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = reduceMotion ? 0 : 600;
  const days = d3.format(".1f");
  const dash = (s) => String(s).replace("-", "–"); // "17-25" -> "17–25" for display
  const yearText = (y) => (y == null ? "2011–2021" : y);
  const isDark = (c) => d3.hsl(c).l < 0.5;
  const widthOf = (selector) => document.querySelector(selector).getBoundingClientRect().width || 600;
  // Narrow screens get a smaller row-label font so long road user names still fit the left margin.
  const labelLayout = (selector) => (widthOf(selector) < 560 ? { left: 150, font: "11px" } : { left: 170, font: null });
  const compact3 = d3.format(".3~s"); // 135063 -> "135k" (the shared 2-digit format would round to "140k")
  const pct = (v) => (v > 0 && v < 0.005 ? "<1%" : fmt.percent(v));

  // Shorter display names for the long BITRE labels
  const SHORT = {
    "Car driver, passenger or unknown position": "Car occupant",
    "Heavy transport driver, passenger or unknown position": "Truck occupant",
    "Pick-up truck or van occupant": "Pick-up or van occupant",
    "Car unknown position": "Car, position unknown",
    "Heavy transport driver": "Truck driver",
    "Heavy transport passenger": "Truck passenger",
    "Heavy transport unknown position": "Truck, position unknown",
    "Car, pick-up truck or van": "Car, pick-up or van",
    "Fixed or stationary object": "Fixed object",
    "Non-collision transport accident": "No collision",
  };
  const short = (s) => SHORT[s] ?? s;

  // People not protected by a vehicle body
  const UNPROTECTED = new Set(["Motorcyclist", "Pedal cyclist", "Pedestrian"]);

  /* ---------------- Shared helpers for this page ---------------- */

  // Pill toggle, same look as the Where and Who pages. Calls onPick(value).
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

  // Colour key built from [{ label, colour }]
  function legend(container, items) {
    container.selectAll("span").data(items).join("span")
      .style("--swatch", (d) => d.colour)
      .text((d) => d.label);
  }

  const sumUp = (v) => ({ Hospitalisations: d3.sum(v, (d) => d.Hospitalisations), bed_days: d3.sum(v, (d) => d.bed_days) });
  const years = Array.from(new Set(cpRows.map((d) => d.Year))).sort(d3.ascending);

  /* ================= Road users ================= */
  const users = { year: null, measure: "Hospitalisations" };
  const MEASURES = {
    Hospitalisations: { label: "Hospitalisations", value: (d) => d.Hospitalisations },
    bed_days: { label: "Bed days", value: (d) => d.bed_days },
    avg: { label: "Average stay", value: (d) => d.bed_days / d.Hospitalisations },
  };
  const userColour = (u) => (UNPROTECTED.has(u) ? colours.highlight : u === "Other or unknown" ? colours.muted : colours.main);
  let usersLegend;

  if (cpRows.length) {
    yearSelect("#chart-users-controls", years, (y) => { users.year = y; drawUsers(); });
    segmented("#chart-users-controls", "Measure", Object.entries(MEASURES).map(([value, m]) => ({ value, label: m.label })),
      users.measure, (v) => { users.measure = v; drawUsers(); });
    usersLegend = d3.select("#chart-users-controls").append("div").attr("class", "legend").attr("aria-hidden", "true");
    addCaveat("#chart-users-note", "Road user is the injured person's role in the crash. Average stay = bed days ÷ hospitalisations.");
  }

  function drawUsers() {
    const { left, font } = labelLayout("#chart-users");
    const { svg, g, width, height } = makeSvg("#chart-users", { height: 400, margin: { top: 8, right: 96, bottom: 32, left } });
    const m = MEASURES[users.measure];
    svg.attr("role", "group").attr("aria-label", `Bar chart of road crash ${m.label.toLowerCase()} by road user, ${yearText(users.year)}`);

    const filtered = cpRows.filter((d) => users.year == null || d.Year === users.year);
    const rows = d3.rollups(filtered, sumUp, (d) => d.road_user)
      .map(([road_user, v]) => ({ road_user, ...v }))
      .map((d) => ({ ...d, value: m.value(d) }))
      .sort((a, b) => b.value - a.value);
    const total = d3.sum(rows, (d) => d.value);
    const isShare = users.measure !== "avg";

    // Legend shows how much of the total is people outside a vehicle
    const outside = d3.sum(rows.filter((d) => UNPROTECTED.has(d.road_user)), (d) => d.value) / total;
    legend(usersLegend, [
      { label: isShare ? `Not in a vehicle · ${fmt.percent(outside)}` : "Not in a vehicle", colour: colours.highlight },
      { label: "In a vehicle", colour: colours.main },
      { label: "Other or unknown", colour: colours.muted },
    ]);

    const x = d3.scaleLinear([0, d3.max(rows, (d) => d.value)], [0, width]).nice();
    const y = d3.scaleBand(rows.map((d) => d.road_user), [0, height]).padding(0.22);

    g.append("g").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(width < 400 ? 3 : 6).tickFormat(isShare ? fmt.compact : (v) => `${v} d`));
    g.append("g").selectAll("text").data(rows).join("text")
      .attr("class", "row-label").attr("x", -10).attr("y", (d) => y(d.road_user) + y.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "end").style("font-size", font).text((d) => short(d.road_user));

    const bars = g.append("g").selectAll("rect").data(rows).join("rect")
      .attr("class", "bar")
      .attr("y", (d) => y(d.road_user))
      .attr("height", y.bandwidth())
      .attr("rx", 4)
      .attr("fill", (d) => userColour(d.road_user))
      .attr("width", 0);
    bars.transition().duration(DURATION).attr("width", (d) => x(d.value));

    bindTip(bars, (d) =>
      `<strong>${d.road_user}, ${yearText(users.year)}</strong><br>${fmt.number(d.Hospitalisations)} hospitalisations` +
      `<br>${fmt.number(d.bed_days)} bed days<br>Average stay ${days(d.bed_days / d.Hospitalisations)} days`);

    g.append("g").selectAll("text").data(rows).join("text")
      .attr("class", "value")
      .attr("x", (d) => x(d.value) + 6)
      .attr("y", (d) => y(d.road_user) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .text((d) => (isShare ? `${compact3(d.value)} · ${pct(d.value / total)}` : `${days(d.value)} days`));
  }

  /* ================= Hit by what ================= */
  const CP_GROUPS = ["Car, pick-up truck or van", "Fixed or stationary object", "Non-collision transport accident", "Other"];
  const CP_COLOUR = {
    "Car, pick-up truck or van": colours.main,
    "Fixed or stationary object": colours.categories[1],
    "Non-collision transport accident": colours.highlight,
    Other: colours.muted,
  };
  const hit = { year: null, sort: "total" };

  if (cpRows.length) {
    yearSelect("#chart-counterparty-controls", years, (y) => { hit.year = y; drawHit(); });
    const wrap = d3.select("#chart-counterparty-controls");
    wrap.append("label").attr("for", "counterparty-sort").text("Sort by ");
    wrap.append("select").attr("id", "counterparty-sort")
      .on("change", (event) => { hit.sort = event.target.value; drawHit(); })
      .selectAll("option")
      .data([{ value: "total", label: "Most hospitalisations" }, ...CP_GROUPS.map((c) => ({ value: c, label: `Share: ${short(c)}` }))])
      .join("option")
      .attr("value", (d) => d.value)
      .text((d) => d.label);
    legend(wrap.append("div").attr("class", "legend").attr("aria-hidden", "true"),
      CP_GROUPS.map((c) => ({ label: short(c), colour: CP_COLOUR[c] })));
    addCaveat("#chart-counterparty-note",
      "No collision means the person was hurt without hitting anything, for example by falling off or overturning. Each bar adds to 100% of that road user's hospitalisations.");
  }

  function drawHit() {
    const { svg, g, width, height } = makeSvg("#chart-counterparty", { height: 440, margin: { top: 24, right: 16, bottom: 32, left: 8 } });
    svg.attr("role", "group").attr("aria-label", `Stacked bar chart of what each road user collided with, ${yearText(hit.year)}`);

    const filtered = cpRows.filter((d) => hit.year == null || d.Year === hit.year);
    const rows = d3.rollups(filtered, (v) => {
      const total = d3.sum(v, (d) => d.Hospitalisations);
      let start = 0;
      const segments = CP_GROUPS.map((cp) => {
        const count = d3.sum(v.filter((d) => d.counterparty_group === cp), (d) => d.Hospitalisations);
        const seg = { cp, count, share: count / total, start };
        start += seg.share;
        return seg;
      });
      return { total, segments };
    }, (d) => d.road_user_group).map(([group, v]) => {
      v.segments.forEach((s) => { s.group = group; });
      return { group, ...v };
    });
    const shareOf = (r, cp) => r.segments.find((s) => s.cp === cp).share;
    rows.sort((a, b) => (hit.sort === "total" ? b.total - a.total : shareOf(b, hit.sort) - shareOf(a, hit.sort)));

    const x = d3.scaleLinear([0, 1], [0, width]);
    const y = d3.scaleBand(rows.map((r) => r.group), [0, height]).paddingInner(0.55).paddingOuter(0.05);
    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(fmt.percent));

    g.append("g").selectAll("text").data(rows).join("text")
      .attr("class", "row-label").attr("x", 0).attr("y", (r) => y(r.group) - 6)
      .text((r) => `${short(r.group)} · ${fmt.number(r.total)} hospitalisations`);

    const segs = rows.flatMap((r) => r.segments);
    const bars = g.append("g").selectAll("rect").data(segs).join("rect")
      .attr("class", "bar")
      .attr("y", (d) => y(d.group))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => CP_COLOUR[d.cp])
      .attr("opacity", (d) => (hit.sort === "total" || d.cp === hit.sort ? 1 : 0.35))
      .attr("x", 0)
      .attr("width", 0);
    bars.transition().duration(DURATION).attr("x", (d) => x(d.start)).attr("width", (d) => Math.max(0, x(d.share) - 1));

    bindTip(bars, (d) =>
      `<strong>${short(d.group)}, ${yearText(hit.year)}</strong><br>Hit: ${d.cp === "Other" ? "other or unspecified" : short(d.cp).toLowerCase()}` +
      `<br>${fmt.number(d.count)} hospitalisations<br>${pct(d.share)} of ${short(d.group).toLowerCase()} hospitalisations`);

    g.append("g").selectAll("text").data(segs.filter((d) => x(d.share) > 36)).join("text")
      .attr("class", "seg-label")
      .attr("x", (d) => x(d.start) + 6)
      .attr("y", (d) => y(d.group) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .style("fill", (d) => (isDark(CP_COLOUR[d.cp]) ? "#fff" : "#000"))
      .style("opacity", (d) => (hit.sort === "total" || d.cp === hit.sort ? 1 : 0.5))
      .text((d) => fmt.percent(d.share));
  }

  /* ================= Road users by age ================= */
  const AGES = Array.from(d3.rollup(ageRows, (v) => v[0].age_order, (d) => d.age_group))
    .sort((a, b) => a[1] - b[1])
    .map((d) => d[0]);
  const GROUPS = Array.from(d3.rollup(ageRows, (v) => d3.sum(v, (d) => d.Hospitalisations), (d) => d.road_user_group))
    .sort((a, b) => b[1] - a[1])
    .map((d) => d[0]);
  const ageYears = Array.from(new Set(ageRows.map((d) => d.Year))).sort(d3.ascending);
  const heat = { year: null, mode: "share" };

  if (ageRows.length) {
    yearSelect("#chart-age-controls", ageYears, (y) => { heat.year = y; drawHeat(); });
    segmented("#chart-age-controls", "Colour by", [
      { value: "share", label: "Share of age group" },
      { value: "count", label: "Count" },
    ], heat.mode, (v) => { heat.mode = v; drawHeat(); });
    addCaveat("#chart-age-note", "In share mode each age column adds to 100%, so you can compare ages of very different sizes.");
  }

  function drawHeat() {
    const { left, font } = labelLayout("#chart-age");
    const { svg, g, width, height } = makeSvg("#chart-age", { height: 420, margin: { top: 56, right: 8, bottom: 44, left } });
    const share = heat.mode === "share";
    svg.attr("role", "group").attr("aria-label", `Heatmap of hospitalisations by road user and age group, ${yearText(heat.year)}`);

    const filtered = ageRows.filter((d) => heat.year == null || d.Year === heat.year);
    const counts = d3.rollup(filtered, (v) => d3.sum(v, (d) => d.Hospitalisations), (d) => d.road_user_group, (d) => d.age_group);
    const ageTotals = d3.rollup(filtered, (v) => d3.sum(v, (d) => d.Hospitalisations), (d) => d.age_group);
    // Every road user and age pair, with 0 where the data has no row
    const cells = GROUPS.flatMap((group) => AGES.map((age) => {
      const count = counts.get(group)?.get(age) ?? 0;
      const ageTotal = ageTotals.get(age) || 1;
      return { group, age, count, share: count / ageTotal, value: share ? count / ageTotal : count };
    }));

    const max = d3.max(cells, (d) => d.value);
    const colour = d3.scaleSequential([0, max], colours.sequential);
    const x = d3.scaleBand(AGES, [0, width]).padding(0.06);
    const y = d3.scaleBand(GROUPS, [0, height]).padding(0.06);

    const ageAxis = g.append("g").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(dash))
      .call((a) => a.select(".domain").remove());
    // Tilt the age labels when the columns are too narrow for them to sit side by side
    if (x.bandwidth() < 44) {
      ageAxis.selectAll("text").attr("text-anchor", "end").attr("transform", "rotate(-40)").attr("dx", "-0.2em").attr("dy", "0.6em");
    }
    g.append("g").selectAll("text").data(GROUPS).join("text")
      .attr("class", "row-label").attr("x", -10).attr("y", (d) => y(d) + y.bandwidth() / 2)
      .attr("dy", "0.35em").attr("text-anchor", "end").style("font-size", font).text(short);

    const rects = g.append("g").selectAll("rect").data(cells).join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.age))
      .attr("y", (d) => y(d.group))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("rx", 4)
      .attr("fill", colours.sequential(0));
    rects.transition().duration(DURATION).attr("fill", (d) => colour(d.value));

    bindTip(rects, (d) =>
      `<strong>${short(d.group)}, aged ${dash(d.age)}, ${yearText(heat.year)}</strong><br>${fmt.number(d.count)} hospitalisations` +
      `<br>${pct(d.share)} of everyone aged ${dash(d.age)}`);

    if (x.bandwidth() >= 34) {
      g.append("g").selectAll("text").data(cells).join("text")
        .attr("class", "cell-label")
        .attr("x", (d) => x(d.age) + x.bandwidth() / 2)
        .attr("y", (d) => y(d.group) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .style("fill", (d) => (isDark(colour(d.value)) ? "#fff" : "#000"))
        .text((d) => (share ? pct(d.value) : compact3(d.value)));
    }

    // Colour legend above the grid
    const legendW = Math.min(240, width);
    const lg = g.append("g").attr("transform", "translate(0,-40)");
    const grad = lg.append("defs").append("linearGradient").attr("id", "how-heat-grad");
    d3.range(0, 1.01, 0.1).forEach((p) => grad.append("stop").attr("offset", `${p * 100}%`).attr("stop-color", colour(p * max)));
    lg.append("text").attr("class", "legend-title").attr("y", -4)
      .text(share ? "Share of each age group's hospitalisations" : "Hospitalisations");
    lg.append("rect").attr("width", legendW).attr("height", 8).attr("rx", 3).attr("fill", "url(#how-heat-grad)");
    lg.append("g").attr("transform", "translate(0,8)")
      .call(d3.axisBottom(d3.scaleLinear([0, max], [0, legendW])).ticks(4).tickSize(3).tickFormat(share ? fmt.percent : fmt.compact))
      .call((a) => a.select(".domain").remove());
  }

  /* ---------------- Draw and redraw on resize ---------------- */
  function drawAll() {
    if (cpRows.length) { drawUsers(); drawHit(); }
    if (ageRows.length) drawHeat();
  }
  drawAll();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawAll, 200);
  });
})();
