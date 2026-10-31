
(async function init() {
  const data = await G29.loadCSV("yearly_total", "#chart-example");
  if (!data.length) return;

  drawExampleChart(data);
})();

function drawExampleChart(data) {
  const { svg, g, width, height } = G29.makeSvg("#chart-example", { height: 320 });
  svg.attr("aria-label", "Bar chart of hospitalisations per year, 2011 to 2021");

  const x = d3.scaleBand().domain(data.map((d) => d.Year)).range([0, width]).padding(0.2);
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.Hospitalisations)]).nice().range([height, 0]);

  g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(G29.fmt.compact));

  g.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (d) => x(d.Year))
    .attr("y", (d) => y(d.Hospitalisations))
    .attr("width", x.bandwidth())
    .attr("height", (d) => height - y(d.Hospitalisations))
    .attr("fill", (d) => (d.Year === 2020 ? G29.colours.highlight : G29.colours.main))
    .on("mouseenter", (event, d) => G29.tooltip.show(event, `<strong>${d.Year}</strong><br>${G29.fmt.number(d.Hospitalisations)} hospitalisations`))
    .on("mousemove", (event) => G29.tooltip.move(event))
    .on("mouseleave", () => G29.tooltip.hide());
}
