/* Falling Short: chart rendering and interaction.
   Depends on js/districts.js (window.RWANDA_DISTRICTS) being loaded first. */
(function(){
"use strict";

/* ==========================================================================
   Data (Rwanda DHS 2025 unless noted)
   ========================================================================== */
const NOW = 26.8, TARGET = 15, BASE_YEAR = 2025, TARGET_YEAR = 2029;

// [year, % stunted, axis label]
const TREND = [[2000,48,"2000"],[2005,51,"2005"],[2010,44,"2010"],[2015,38,"2014–15"],[2020,33,"2019–20"],[2025,26.8,"2025"]];

// [age group, % stunted, children measured]
const AGES = [["Under 6 months",16.7,717],["6–11 months",19.8,731],["12–23 months",33.2,1414],["2 years",30.6,1457],["3 years",27.2,1545],["4 years",24.6,1429]];

// [upper bound (exclusive), colour, legend label]
const BINS = [[15,"#d6ebfb","<15"],[20,"#a9d3f5","15–20"],[25,"#79b6ea","20–25"],[30,"#4f8fd3","25–30"],[35,"#ffe27a","30–35"],[101,"#ffc21a","35%+"]];

const PROVINCES = {North:"Northern Province",West:"Western Province",South:"Southern Province",East:"Eastern Province",Kigali:"City of Kigali"};

// rows: [group, % stunted, children measured]
const GAPS = {
  "Mother’s education": {rows:[["No education",37.8,435],["Primary",29.9,4141],["Secondary",19.6,1928],["More than secondary",5.8,303]], text:"Children of mothers with no schooling are 6.5 times as likely to be stunted as children of mothers educated beyond secondary school."},
  "Household wealth": {rows:[["Poorest 20%",39.8,1647],["Second 20%",32.1,1487],["Middle 20%",28.9,1460],["Fourth 20%",19.9,1380],["Richest 20%",9.2,1320]], text:"Children in the poorest fifth of homes are 4.3 times as likely to be stunted as children in the richest fifth."},
  "Size at birth": {rows:[["Very small",49.0,147],["Small",38.9,614],["Average or larger",23.7,3366]], text:"Babies born very small are about twice as likely to be stunted as babies of average size or larger."},
  "Mother’s age at birth": {rows:[["Under 20",32.1,458],["20–34",25.5,4561],["35–49",27.5,1717]], text:"Children of teenage mothers are 1.3 times as likely to be stunted as children of mothers aged 20–34."},
  "Urban or rural": {rows:[["Rural",30.1,5173],["Urban",18.6,2120]], text:"Rural children are 1.6 times as likely to be stunted as urban children."},
  "Province": {rows:[["Northern",32.7,1008],["Western",32.6,1593],["Southern",26.1,1622],["Eastern",25.8,2094],["City of Kigali",14.2,975]], text:"Children in the Northern Province are 2.3 times as likely to be stunted as children in the City of Kigali."},
  "Child’s sex": {rows:[["Boys",29.3,3654],["Girls",24.1,3638]], text:"Boys are 1.2 times as likely to be stunted as girls."}
};

const DISTRICTS = window.RWANDA_DISTRICTS;

/* ==========================================================================
   Helpers
   ========================================================================== */
const NS = "http://www.w3.org/2000/svg";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => motionQuery.matches;
const smooth = () => reduced() ? "auto" : "smooth";

// Hide a chart's animated parts while it is off screen, so its CSS transitions replay on every return.
function reveal(node, onShow){
  if (!("IntersectionObserver" in window)) return;
  node.classList.add("pending");
  new IntersectionObserver(entries => entries.forEach(e => {
    if (e.intersectionRatio >= .2){
      if (!node.classList.contains("pending")) return;
      node.classList.remove("pending");
      if (onShow) onShow();
    } else if (!e.isIntersecting) node.classList.add("pending");
  }), {threshold:[0, .2]}).observe(node);
}

/* ==========================================================================
   Tooltip (mouse hover, touch tap, keyboard focus)
   ========================================================================== */
const tip = $("#tip");
let tipOwner = null, tipHTML = "", tipTouch = false;

function showTip(html, x, y){
  if (html !== tipHTML){ tip.innerHTML = html; tipHTML = html; }
  tip.classList.add("show");
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let L = x + 14, T = y - h - 12;
  if (L + w > innerWidth - 8) L = x - w - 14;
  if (T < 8) T = y + 16;
  tip.style.left = Math.max(8, L) + "px";
  tip.style.top = Math.min(T, innerHeight - h - 8) + "px";
}
function hideTip(){ tip.classList.remove("show"); tipOwner = null; tipTouch = false; }
function bindTip(node, html){
  node.addEventListener("pointermove", e => { if (e.pointerType === "touch") return; tipOwner = node; showTip(html(), e.clientX, e.clientY); });
  node.addEventListener("pointerleave", e => { if (e.pointerType !== "touch" && tipOwner === node) hideTip(); });
  node.addEventListener("pointerup", e => { if (e.pointerType !== "touch") return; tipOwner = node; tipTouch = true; showTip(html(), e.clientX, e.clientY); });
  node.addEventListener("focus", () => { if (tipTouch) return; const r = node.getBoundingClientRect(); tipOwner = node; showTip(html(), r.left + r.width / 2, r.top); });
  node.addEventListener("blur", () => { if (tipOwner === node && !tipTouch) hideTip(); });
}
// A touch tip stays until the next tap elsewhere or a scroll.
document.addEventListener("pointerdown", e => { if (tipOwner && !tipOwner.contains(e.target)) hideTip(); });
addEventListener("scroll", () => { if (tipTouch) hideTip(); }, {passive:true});
document.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });

/* ==========================================================================
   Chapter nav: active chapter
   ========================================================================== */
const navWrap = $(".chnav .wrap"), navLinks = $$(".chnav a"), sections = $$("section.ch");
let activeId, ticking = false;

function setActive(id){
  navLinks.forEach(a => {
    const on = a.getAttribute("href") === "#" + id;
    a.classList.toggle("on", on);
    if (on){ a.setAttribute("aria-current", "true"); navWrap.scrollTo({left:a.offsetLeft - 16, behavior:smooth()}); }
    else a.removeAttribute("aria-current");
  });
}
function onScroll(){
  ticking = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  const line = innerHeight * .4;
  let id = null;
  sections.forEach(s => { if (s.getBoundingClientRect().top <= line) id = s.id; });
  if (max - scrollY < 4) id = sections[sections.length - 1].id;
  if (id !== activeId){ activeId = id; setActive(id); }
}
addEventListener("scroll", () => { if (!ticking){ ticking = true; requestAnimationFrame(onScroll); } }, {passive:true});
addEventListener("resize", onScroll);
onScroll();

/* ==========================================================================
   Hero: 100 children
   ========================================================================== */
const kidsBox = $("#kids"), heroNum = $("#heroNum"), heroCap = $("#heroCap");
const yearSeg = $("#yearSeg"), yearBtns = $$("button", yearSeg), playBtn = $("#heroPlay");
const FIG = '<div class="kid"><svg viewBox="0 0 10 16" aria-hidden="true"><path d="M5 0a2.3 2.3 0 1 1 0 4.6A2.3 2.3 0 0 1 5 0zM2.2 5.4h5.6a1.4 1.4 0 0 1 1.4 1.4v4.1H7.6V16H5.8v-4.6H4.2V16H2.4v-5.1H.8V6.8a1.4 1.4 0 0 1 1.4-1.4z"/></svg></div>';
kidsBox.innerHTML = FIG.repeat(100);
const kidEls = [...kidsBox.children];
let heroAnim = 0, playTimer = null, introTimer = null;

function setHero(v, label){
  // Stagger only the figures that change, filling forward or emptying backward.
  const wasOn = kidEls.filter(k => k.classList.contains("on")).length;
  const changed = kidEls.filter((k, i) => k.classList.contains("on") !== (i < v));
  if (v < wasOn) changed.reverse();
  changed.forEach((k, j) => { k.style.setProperty("--d", (reduced() ? 0 : j * 9) + "ms"); k.classList.toggle("on"); });
  kidsBox.setAttribute("aria-label", `100 children, ${v} of them highlighted as stunted`);
  heroCap.textContent = `of children under five are stunted (too short for their age) ${label}`;

  const start = parseInt(heroNum.textContent, 10) || 0, t0 = performance.now(), id = ++heroAnim;
  const step = t => {
    if (id !== heroAnim) return;
    const p = reduced() ? 1 : Math.min(1, (t - t0) / 600), eased = 1 - Math.pow(1 - p, 3);
    heroNum.textContent = Math.round(start + (v - start) * eased) + "%";
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function selectYear(b){
  yearBtns.forEach(x => x.setAttribute("aria-pressed", x === b));
  setHero(+b.dataset.v, b.dataset.l);
}
function stopPlay(){
  clearTimeout(playTimer); clearTimeout(introTimer); playTimer = null;
  playBtn.setAttribute("aria-pressed", "false"); playBtn.textContent = "Play";
}
function playFrom(i){
  selectYear(yearBtns[i]);
  playTimer = setTimeout(i < yearBtns.length - 1 ? () => playFrom(i + 1) : stopPlay, 1600);
}
yearSeg.addEventListener("click", e => { const b = e.target.closest("button"); if (b){ stopPlay(); selectYear(b); } });
playBtn.addEventListener("click", () => {
  clearTimeout(introTimer);
  if (playTimer){ stopPlay(); return; }
  playBtn.setAttribute("aria-pressed", "true"); playBtn.textContent = "Stop";
  playFrom(0);
});
selectYear(yearBtns.find(b => b.getAttribute("aria-pressed") === "true") || yearBtns[yearBtns.length - 2]);

/* ==========================================================================
   Responsive SVG charts: each chart is redrawn at its container's real pixel
   width, so text stays readable on phones instead of shrinking or scrolling.
   ========================================================================== */
function responsive(svg, draw){
  let width = 0;
  const run = () => {
    const w = Math.max(300, Math.round(svg.parentElement.clientWidth));
    if (Math.abs(w - width) < 2) return;
    width = w;
    svg.replaceChildren();
    draw(w);
  };
  run();
  if ("ResizeObserver" in window) new ResizeObserver(run).observe(svg.parentElement);
  else addEventListener("resize", run);
}
const shortYear = (y, label, narrow) => narrow && y !== 2000 ? "’" + String(y).slice(2) : label;

/* ==========================================================================
   01 Trend + pace
   ========================================================================== */
const trend = $("#trend"), pace = $("#pace"), paceOut = $("#paceOut"), verdict = $("#verdict");
const YEARS_LEFT = TARGET_YEAR - BASE_YEAR;
let paceNow = +pace.value, proj = null, dragging = false;

function drawTrend(W){
  const narrow = W < 520, H = narrow ? 300 : 330;
  const x0 = narrow ? 40 : 56, x1 = W - (narrow ? 36 : 44), yB = H - 40, yT = 26;
  const tx = y => x0 + (y - 2000) * (x1 - x0) / (TARGET_YEAR - 2000);
  const ty = v => yB - v * (yB - yT) / 60;
  const pts = TREND.map(d => `${tx(d[0])} ${ty(d[1])}`).join("L");
  const axis = "axis" + (narrow ? " sm" : "");
  trend.setAttribute("viewBox", `0 0 ${W} ${H}`);

  [0, 20, 40, 60].forEach(v => {
    el("line", {x1:x0, x2:x1, y1:ty(v), y2:ty(v), stroke:css("--line"), "stroke-width":1}, trend);
    el("text", {x:x0 - 8, y:ty(v) + 4, "text-anchor":"end", class:axis}, trend).textContent = v + "%";
  });
  TREND.forEach(d => { el("text", {x:tx(d[0]), y:H - 16, "text-anchor":"middle", class:axis}, trend).textContent = shortYear(d[0], d[2], narrow); });
  el("text", {x:tx(TARGET_YEAR), y:H - 16, "text-anchor":"middle", class:axis, style:"fill:var(--fg);font-weight:700"}, trend).textContent = shortYear(TARGET_YEAR, TARGET_YEAR, narrow);

  // Target as a reference across the whole chart, so the distance to it is visible every year.
  el("line", {x1:x0, x2:x1, y1:ty(TARGET), y2:ty(TARGET), stroke:css("--accent"), "stroke-width":1.5, "stroke-dasharray":"2 4", opacity:.8}, trend);
  el("text", {x:x0 + 6, y:ty(TARGET) - 7, fill:css("--accent"), "font-size":13, "font-weight":700}, trend).textContent = "15% NST2 target";

  el("path", {d:`M${pts}L${tx(BASE_YEAR)} ${ty(0)}L${tx(2000)} ${ty(0)}Z`, class:"area", fill:css("--sky-soft"), "fill-opacity":.16}, trend);
  el("path", {d:"M" + pts, class:"line", pathLength:1, fill:"none", stroke:css("--sky-soft"), "stroke-width":4, "stroke-linejoin":"round"}, trend);

  // Projection: shortfall wedge between your pace and the path the target needs.
  const shade = el("path", {class:"shortfall"}, trend);
  el("line", {x1:tx(BASE_YEAR), y1:ty(NOW), x2:tx(TARGET_YEAR), y2:ty(TARGET), stroke:css("--sky-soft"), "stroke-width":2, "stroke-dasharray":"3 5"}, trend);
  el("text", {x:tx(TARGET_YEAR) + 8, y:ty(TARGET) + 20, "text-anchor":"end", class:"ref-label"}, trend).textContent = "target path";
  const line = el("line", {x1:tx(BASE_YEAR), y1:ty(NOW), x2:tx(TARGET_YEAR), stroke:css("--accent"), "stroke-width":3, "stroke-dasharray":"7 6"}, trend);
  const dot = el("circle", {cx:tx(TARGET_YEAR), r:8, fill:css("--accent"), stroke:css("--bg-deep"), "stroke-width":2}, trend);
  const lbl = el("text", {x:tx(TARGET_YEAR) + 8, "text-anchor":"end", class:"num-label", fill:css("--accent"), "font-size":15, "font-weight":700}, trend);
  const hit = el("circle", {cx:tx(TARGET_YEAR), r:22, class:"drag-hit", "aria-hidden":"true"}, trend);

  const route = trendRoute(tx, ty);
  TREND.forEach((d, i) => {
    el("text", {x:tx(d[0]), y:ty(d[1]) - 16, "text-anchor":"middle", class:"vlabel", style:`transition-delay:${Math.round(route.at[i] / route.total * LINE_MS)}ms`}, trend).textContent = Math.round(d[1]) + "%";
    const c = el("circle", {cx:tx(d[0]), cy:ty(d[1]), r:7, fill:css("--bg-deep"), stroke:css("--sky-soft"), "stroke-width":3, tabindex:0, role:"img", "aria-label":`${d[2]}: ${d[1]}% stunted`}, trend);
    bindTip(c, () => `<b>${d[2]}</b><br>${d[1]}% of children under five stunted`);
  });
  const guide = el("line", {y1:yT, y2:yB, class:"guide", display:"none"}, trend);
  const ring = el("circle", {cx:tx(TARGET_YEAR), r:8, class:"ring", display:"none"}, trend);
  const head = el("circle", {r:6, class:"comet", display:"none"}, trend);
  const headLbl = el("text", {class:"comet-label", "text-anchor":"middle", display:"none"}, trend);
  ring.addEventListener("animationend", () => { ring.classList.remove("go"); ring.setAttribute("display", "none"); });
  trend.appendChild(hit);

  proj = {tx, ty, W, H, yB, yT, shade, line, dot, lbl, hit, ring, head, headLbl, route, guide};
  bindDrag(hit);
  bindTip(hit, () => `<b>${TARGET_YEAR} at ${paceOut.textContent} points a year</b><br>${fmt(projected(paceNow))}% stunted. Drag to change.`);
  placeProjection();
}

const projected = p => Math.max(0, NOW - YEARS_LEFT * p);

// The drawn line as measured segments, so the moving head can stay on its tip.
const LINE_MS = 1400, TAIL_MS = 750;
function trendRoute(tx, ty){
  const pts = TREND.map(d => [tx(d[0]), ty(d[1]), d[1]]), at = [0];
  pts.slice(1).forEach((p, i) => at.push(at[i] + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])));
  return {pts, at, total:at[at.length - 1]};
}

// A glowing head runs the line, carries on down the projection, and rings out where it lands.
let cometRun = 0;
function runComet(){
  if (reduced() || !proj) return;
  const {tx, ty, ring, head, headLbl, route:{pts, at, total}} = proj, id = ++cometRun, t0 = performance.now();
  const place = (x, y, v) => {
    head.setAttribute("cx", x); head.setAttribute("cy", y);
    headLbl.setAttribute("x", x); headLbl.setAttribute("y", y - 16);
    headLbl.textContent = fmt(v) + "%";
  };
  const hide = () => { head.setAttribute("display", "none"); headLbl.setAttribute("display", "none"); };
  head.removeAttribute("display"); headLbl.removeAttribute("display");
  ring.classList.remove("go"); ring.setAttribute("display", "none");
  const tick = t => {
    if (id !== cometRun || proj.head !== head) return;
    if (trend.classList.contains("pending")) return hide();
    const ms = t - t0;
    if (ms < LINE_MS){
      const d = Math.max(0, ms / LINE_MS) * total;
      let i = at.findIndex((a, k) => k > 0 && d <= a);
      if (i < 1) i = 1;
      const f = (d - at[i - 1]) / (at[i] - at[i - 1]), a = pts[i - 1], b = pts[i];
      place(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    } else if (ms < LINE_MS + TAIL_MS){
      const f = 1 - Math.pow(1 - (ms - LINE_MS) / TAIL_MS, 3), v = NOW + (projected(paceNow) - NOW) * f;
      place(tx(BASE_YEAR) + (tx(TARGET_YEAR) - tx(BASE_YEAR)) * f, ty(v), v);
    } else {
      hide();
      ring.setAttribute("cy", ty(projected(paceNow)));
      ring.removeAttribute("display");
      ring.classList.add("go");
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function placeProjection(){
  if (!proj) return;
  const {tx, ty, shade, line, dot, lbl, hit} = proj, v = projected(paceNow), y = ty(v);
  line.setAttribute("y2", y); dot.setAttribute("cy", y); hit.setAttribute("cy", y);
  lbl.setAttribute("y", v > TARGET ? y - 14 : y + 24);
  lbl.textContent = `≈${fmt(v)}%`;
  shade.setAttribute("d", `M${tx(BASE_YEAR)} ${ty(NOW)}L${tx(TARGET_YEAR)} ${y}L${tx(TARGET_YEAR)} ${ty(TARGET)}Z`);
  shade.setAttribute("fill", v > TARGET ? "rgba(255,216,77,.2)" : "rgba(92,196,247,.22)");
}

// Drag the 2029 dot vertically; the pace follows, snapped to the slider's 0.05 step.
function bindDrag(hit){
  const move = e => {
    const r = trend.getBoundingClientRect(), {H, yB, yT} = proj;
    const v = (yB - (e.clientY - r.top) * H / r.height) * 60 / (yB - yT);
    setPace(Math.round((NOW - v) / YEARS_LEFT * 20) / 20);
  };
  hit.addEventListener("pointerdown", e => { e.preventDefault(); dragging = true; hit.setPointerCapture(e.pointerId); move(e); });
  hit.addEventListener("pointermove", e => { if (dragging) move(e); });
  ["pointerup", "pointercancel"].forEach(t => hit.addEventListener(t, () => { dragging = false; }));
}

function setPace(p){
  p = Math.max(0, Math.min(4, p));
  paceNow = p;
  const shown = p.toFixed(2).replace(/0$/, "");
  const v = projected(p);
  const reachYear = p > 0 ? Math.ceil(BASE_YEAR + (NOW - TARGET) / p - 1e-9) : null;

  pace.value = p;
  paceOut.textContent = shown;
  pace.setAttribute("aria-valuetext", `${shown} points a year: ${fmt(v)}% stunted in ${TARGET_YEAR}`);
  placeProjection();
  $("#proj").textContent = fmt(v) + "%";
  $("#projKids").textContent = Math.round(v);
  $("#reach").textContent = reachYear ?? "Never";

  if (v <= TARGET + 1e-9){
    verdict.className = "verdict hit";
    verdict.textContent = reachYear < TARGET_YEAR
      ? `At this pace Rwanda reaches the 15% target in ${reachYear}, ahead of schedule.`
      : `At this pace Rwanda reaches the 15% target by ${TARGET_YEAR}.`;
  } else {
    verdict.className = "verdict miss";
    verdict.textContent = `At this pace Rwanda misses the 15% target by about ${fmt(v - TARGET)} points.`;
  }
}
pace.addEventListener("input", e => setPace(+e.target.value));
$$(".presets button").forEach(b => b.addEventListener("click", () => setPace(+b.dataset.p)));
responsive(trend, drawTrend);

// Hovering anywhere on the chart snaps a guide to the nearest year.
function nearestYear(clientX){
  const r = trend.getBoundingClientRect(), x = (clientX - r.left) * proj.W / r.width;
  const stops = TREND.map(d => ({x:proj.tx(d[0]), label:d[2], v:d[1]}));
  stops.push({x:proj.tx(TARGET_YEAR), label:`${TARGET_YEAR} at this pace`, v:projected(paceNow)});
  return stops.reduce((a, b) => Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a);
}
function showYear(e){
  const s = nearestYear(e.clientX), gap = s.v - TARGET;
  showTip(`<b>${s.label}</b><br>${fmt(s.v)}% stunted<br>${fmt(Math.abs(gap))} points ${gap >= 0 ? "above" : "below"} the 15% target`, e.clientX, e.clientY);
  return s;
}
trend.addEventListener("pointermove", e => {
  if (!proj || dragging || e.pointerType === "touch") return;
  tipOwner = trend;
  const s = showYear(e);
  proj.guide.setAttribute("x1", s.x); proj.guide.setAttribute("x2", s.x);
  proj.guide.removeAttribute("display");
});
trend.addEventListener("pointerleave", e => {
  if (e.pointerType === "touch" || !proj) return;
  proj.guide.setAttribute("display", "none");
  if (tipOwner === trend) hideTip();
});
trend.addEventListener("pointerup", e => {
  if (!proj || dragging || e.pointerType !== "touch") return;
  tipOwner = trend; tipTouch = true;
  showYear(e);
});
setPace(paceNow);
reveal(trend, runComet);

/* ==========================================================================
   02 Stunting by age: columns on wide screens, horizontal bars on narrow ones
   ========================================================================== */
const ages = $("#ages");
const isHot = i => i === 1 || i === 2;

function ageBar(d, i, attrs){
  const r = el("rect", Object.assign({rx:6, class:"bar", fill:isHot(i) ? css("--accent") : css("--sky"), "fill-opacity":isHot(i) ? 1 : .55, tabindex:0, role:"img", "aria-label":`${d[0]}: ${d[1]}% stunted`, style:`transition-delay:${i * 80}ms`}, attrs), ages);
  bindTip(r, () => `<b>${d[0]}</b><br>${d[1]}% stunted<br>${d[2].toLocaleString()} children measured`);
}

function drawAges(W){
  const horiz = W < 720;
  ages.classList.toggle("horiz", horiz);
  const refLine = a => el("line", Object.assign({stroke:css("--fg"), "stroke-width":1.5, "stroke-dasharray":"4 4", opacity:.6}, a), ages);

  if (!horiz){
    const H = 300, L = 30, R = W - 30, n = AGES.length;
    const bw = Math.min(110, (R - L) / n * .72), gap = (R - L - n * bw) / (n - 1), ay = v => 240 - v * 5.6, bx = i => L + i * (bw + gap);
    ages.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el("line", {x1:L, x2:R, y1:240, y2:240, stroke:css("--muted"), "stroke-width":1.5}, ages);
    AGES.forEach((d, i) => {
      ageBar(d, i, {x:bx(i), y:ay(d[1]), width:bw, height:240 - ay(d[1])});
      el("text", {x:bx(i) + bw / 2, y:ay(d[1]) - 10, "text-anchor":"middle", class:"vlabel", style:isHot(i) ? "fill:var(--accent)" : ""}, ages).textContent = Math.round(d[1]) + "%";
      el("text", {x:bx(i) + bw / 2, y:262, "text-anchor":"middle", class:"axis"}, ages).textContent = d[0];
    });
    refLine({x1:L, x2:R, y1:ay(NOW), y2:ay(NOW)});
    el("text", {x:L, y:ay(NOW) - 8, class:"ref-label"}, ages).textContent = `National average ${NOW}%`;
    const b0 = bx(1), b1 = bx(2) + bw;
    el("path", {d:`M${b0} 276V284H${b1}V276`, fill:"none", stroke:css("--accent"), "stroke-width":1.5}, ages);
    el("text", {x:(b0 + b1) / 2, y:298, "text-anchor":"middle", fill:css("--accent"), "font-size":14, "font-weight":700}, ages).textContent = "6–23 months: the steepest rise";
    return;
  }

  const rowH = 42, top = 4, labW = 112, L = labW, R = W - 50, sx = v => (R - L) * v / 40;
  const H = top + AGES.length * rowH + 48;
  ages.setAttribute("viewBox", `0 0 ${W} ${H}`);
  AGES.forEach((d, i) => {
    const y = top + i * rowH;
    ageBar(d, i, {x:L, y:y + 8, width:sx(d[1]), height:26});
    el("text", {x:L - 10, y:y + 26, "text-anchor":"end", class:"axis sm", style:isHot(i) ? "fill:var(--accent);font-weight:700" : ""}, ages).textContent = d[0];
    el("text", {x:L + sx(d[1]) + 8, y:y + 27, class:"vlabel", style:isHot(i) ? "fill:var(--accent)" : ""}, ages).textContent = Math.round(d[1]) + "%";
  });
  const yEnd = top + AGES.length * rowH;
  refLine({x1:L + sx(NOW), x2:L + sx(NOW), y1:top + 2, y2:yEnd + 2});
  el("text", {x:L + sx(NOW), y:yEnd + 18, "text-anchor":"middle", class:"ref-label"}, ages).textContent = `National ${NOW}%`;
  el("text", {x:0, y:H - 4, fill:css("--accent"), "font-size":13, "font-weight":700}, ages).textContent = "Yellow: 6–23 months, the steepest rise";
}
responsive(ages, drawAges);
reveal(ages);

/* ==========================================================================
   03 District map + ranking
   ========================================================================== */
const map = $("#map"), rank = $("#rank"), provSeg = $("#provSeg"), rankCount = $("#rankCount");
const binOf = v => BINS.find(b => v < b[0]);
const byRate = DISTRICTS.ds.slice().sort((a, b) => b.v - a.v);
const shapes = {}, rows = {};

$("#legend").innerHTML = BINS.map(b => `<div><i style="background:${b[1]}"></i>${b[2]}</div>`).join("");
map.setAttribute("viewBox", `-4 -4 ${DISTRICTS.W + 8} ${DISTRICTS.H + 8}`);
const shapeLayer = el("g", {}, map);
// One outline drawn on top, so highlighting never reorders (and un-focuses) the district paths.
const outline = el("path", {class:"dist-hl", display:"none", "aria-hidden":"true"}, map);
let hlName = null, pinned = null;

// Faint fixed map behind the whole page.
const bgMap = el("svg", {viewBox:`-4 -4 ${DISTRICTS.W + 8} ${DISTRICTS.H + 8}`, class:"bg-map", "aria-hidden":"true"});
const bgPaths = {};
DISTRICTS.ds.forEach(d => { bgPaths[d.name] = el("path", {d:d.d}, bgMap); });
document.body.prepend(bgMap);

const dcard = $("#dcard");
function showDistrict(d){
  if (!d){
    dcard.innerHTML = '<p class="d-hint">Click a district on the map or in the ranking to pin its profile here.</p>';
    return;
  }
  const diff = d.v - NOW;
  dcard.innerHTML = `<div class="d-top"><div><b class="d-name">${d.name}</b><p>${PROVINCES[d.prov]}</p></div><div class="d-v num">${d.v.toFixed(1)}%</div></div>
    <div class="track"><div class="fill${d.v > 30 ? " top" : ""}" style="width:${d.v / 50 * 100}%"></div><i class="avg" style="left:${NOW / 50 * 100}%" aria-hidden="true"></i></div>
    <p>Rank ${byRate.indexOf(d) + 1} of ${byRate.length} · ${Math.abs(diff).toFixed(1)} points ${diff >= 0 ? "above" : "below"} the national ${NOW}% · ${d.n} children measured</p>`;
}
function pin(d){
  pinned = pinned === d ? null : d;
  highlight(pinned, true);
}

function highlight(d, scrollList){
  if (hlName){ rows[hlName].classList.remove("hl"); bgPaths[hlName].classList.remove("hl"); }
  hlName = d ? d.name : null;
  showDistrict(d);
  if (!d){ outline.setAttribute("display", "none"); return; }
  bgPaths[d.name].classList.add("hl");
  outline.setAttribute("d", d.d);
  outline.removeAttribute("display");
  const li = rows[d.name];
  li.classList.add("hl");
  if (scrollList && rank.scrollHeight > rank.clientHeight){
    const top = li.offsetTop, bottom = top + li.offsetHeight;
    if (top < rank.scrollTop || bottom > rank.scrollTop + rank.clientHeight)
      rank.scrollTo({top:top - (rank.clientHeight - li.offsetHeight) / 2, behavior:smooth()});
  }
}

byRate.forEach((d, i) => {
  const p = el("path", {d:d.d, class:"dist", fill:binOf(d.v)[1], tabindex:0, role:"img", "aria-label":`${d.name}, ${PROVINCES[d.prov]}: ${d.v}% stunted`}, shapeLayer);
  const li = document.createElement("li");
  li.tabIndex = 0;
  if (d.v > 30) li.classList.add("over");
  li.innerHTML = `<span class="i num">${i + 1}</span><span>${d.name} <small>· ${d.prov}</small><span class="bar" style="width:${d.v / 40 * 100}%"></span></span><span class="v num">${d.v.toFixed(1)}%</span>`;
  rank.appendChild(li);
  shapes[d.name] = p; rows[d.name] = li;

  bindTip(p, () => `<b>${d.name}</b> · ${PROVINCES[d.prov]}<br>${d.v}% of children stunted<br>${d.n} children measured`);
  const off = () => { if (hlName === d.name) highlight(pinned); };
  p.addEventListener("pointerenter", () => highlight(d, true));
  p.addEventListener("focus", () => highlight(d, true));
  li.addEventListener("pointerenter", () => highlight(d, false));
  li.addEventListener("focus", () => highlight(d, false));
  [p, li].forEach(n => {
    n.addEventListener("pointerleave", off); n.addEventListener("blur", off);
    n.addEventListener("click", () => pin(d));
    n.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); pin(d); } });
  });
});

showDistrict(null);
document.addEventListener("keydown", e => { if (e.key === "Escape" && pinned) pin(pinned); });

const distFind = $("#distFind");
$("#distList").innerHTML = byRate.map(d => `<option value="${d.name}">`).join("");
distFind.addEventListener("input", () => {
  const d = byRate.find(x => x.name.toLowerCase() === distFind.value.trim().toLowerCase());
  if (d && d !== pinned){ setFilter("all"); pin(d); }
});

function setFilter(f){
  $$("button", provSeg).forEach(b => b.setAttribute("aria-pressed", b.dataset.p === f));
  let shown = 0;
  byRate.forEach(d => {
    const keep = f === "all" || (f === "over" ? d.v > 30 : d.prov === f);
    if (keep) shown++;
    shapes[d.name].classList.toggle("dim", !keep);
    rows[d.name].classList.toggle("dim", !keep);
  });
  rankCount.textContent = `· ${shown} of ${byRate.length} shown`;
}
provSeg.addEventListener("click", e => { const b = e.target.closest("button"); if (b) setFilter(b.dataset.p); });
setFilter("all");

/* ==========================================================================
   04 Who falls short (tabs)
   ========================================================================== */
const gapTabs = $("#gapTabs"), gapPanel = $("#gapPanel"), gapRows = $("#gapRows");
const tabBtns = Object.keys(GAPS).map((k, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "pill"; b.id = "gap-tab-" + i; b.dataset.k = k; b.textContent = k;
  b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "gapPanel");
  b.addEventListener("click", () => setGap(k));
  gapTabs.appendChild(b);
  return b;
});
gapTabs.addEventListener("keydown", e => {
  const i = tabBtns.indexOf(document.activeElement), n = tabBtns.length;
  const j = {ArrowRight:i + 1, ArrowLeft:i - 1, Home:0, End:n - 1}[e.key];
  if (i < 0 || j === undefined) return;
  e.preventDefault();
  const t = tabBtns[(j + n) % n];
  setGap(t.dataset.k); t.focus();
});

function setGap(k){
  tabBtns.forEach(b => {
    const on = b.dataset.k === k;
    b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    if (on) gapPanel.setAttribute("aria-labelledby", b.id);
  });
  const g = GAPS[k], vals = g.rows.map(r => r[1]), mx = Math.max(...vals), mn = Math.min(...vals);
  gapRows.innerHTML = g.rows.map(r =>
    `<div class="gap-row"><div class="lbl">${r[0]}<small class="num">${r[2].toLocaleString()} children</small></div><div class="track"><div class="fill${r[1] === mx ? " top" : ""}" data-w="${r[1] / 50 * 100}"></div><i class="avg" style="left:${NOW / 50 * 100}%" aria-hidden="true"></i></div><div class="v num">${r[1].toFixed(1)}%</div></div>`
  ).join("");
  $$(".gap-row", gapRows).forEach((row, i) => {
    const r = g.rows[i], diff = r[1] - NOW, say = `${Math.abs(diff).toFixed(1)} points ${diff >= 0 ? "above" : "below"} the national ${NOW}%`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-expanded", "false");
    row.setAttribute("aria-label", `${r[0]}: ${r[1]}% stunted, ${say}`);
    row.insertAdjacentHTML("beforeend", `<div class="gap-detail"><div><dl>
      <div><dt>Stunted</dt><dd class="num">${r[1].toFixed(1)}%</dd></div>
      <div><dt>Against the national ${NOW}%</dt><dd class="num">${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} points</dd></div>
      <div><dt>Children measured</dt><dd class="num">${r[2].toLocaleString()}</dd></div>
      <div><dt>Estimated stunted</dt><dd class="num">about ${Math.round(r[2] * r[1] / 100).toLocaleString()}</dd></div>
    </dl></div></div>`);
    const toggle = () => {
      const open = !row.classList.contains("open");
      $$(".gap-row", gapRows).forEach(x => { x.classList.remove("open"); x.setAttribute("aria-expanded", "false"); });
      row.classList.toggle("open", open);
      row.setAttribute("aria-expanded", open);
      hideTip();
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); } });
    bindTip(row, () => `<b>${r[0]}</b><br>${r[1]}% stunted<br>${say}<br>${r[2].toLocaleString()} children measured<br>Press for full data`);
  });
  // Two frames so the bars start at 0 and the width transition plays.
  requestAnimationFrame(() => requestAnimationFrame(() => $$(".fill", gapRows).forEach(f => { f.style.width = f.dataset.w + "%"; })));
  $("#gapX").textContent = (mx / mn).toFixed(1) + "×";
  $("#gapText").textContent = g.text;
}
setGap(Object.keys(GAPS)[0]);

/* ==========================================================================
   05 Action links jump to the matching view
   ========================================================================== */
$$("a[data-gap]").forEach(a => a.addEventListener("click", () => setGap(a.dataset.gap)));
$$(".act a[data-filter]").forEach(a => a.addEventListener("click", () => setFilter(a.dataset.filter)));

/* ==========================================================================
   Card spotlight follows the mouse
   ========================================================================== */
document.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || !(e.target instanceof Element)) return;
  const card = e.target.closest(".card, .hero-panel");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", e.clientX - r.left + "px");
  card.style.setProperty("--my", e.clientY - r.top + "px");
}, {passive:true});

/* ==========================================================================
   Slow reveal while scrolling, in both directions
   ========================================================================== */
if ("IntersectionObserver" in window && !reduced()){
  // Opening: the hero replays twenty years of progress, then settles on 2025.
  const step = i => {
    selectYear(yearBtns[i]);
    if (i < 2) introTimer = setTimeout(() => step(i + 1), 1500);
  };
  heroNum.textContent = yearBtns[0].dataset.v + "%";
  selectYear(yearBtns[0]);
  introTimer = setTimeout(() => step(1), 2100);

  const blocks = $$("header .wrap > div, .fact, .ch-head, .ch .card, .filters, .act, .team, footer .wrap > div:not(.team)");

  // Headlines: each word rises from behind a mask.
  $$("h1, h2").forEach(h => {
    h.innerHTML = h.textContent.trim().split(/\s+/).map((w, i) => `<span class="w"><span style="--i:${i}">${w}</span></span>`).join(" ");
  });

  // Hero, map and ranking cascade; the map lights up worst district first.
  kidEls.forEach((k, i) => k.style.setProperty("--dd", i * 11 + "ms"));
  byRate.forEach((d, i) => {
    shapes[d.name].style.setProperty("--dd", i * 34 + "ms");
    rows[d.name].style.setProperty("--dd", i * 34 + "ms");
  });

  blocks.forEach(b => {
    b.classList.add("reveal");
    b.style.setProperty("--rd", Math.min([...b.parentElement.children].indexOf(b), 3) * 140 + "ms");
  });

  // Key figures count up from zero each time their block arrives.
  const counters = new Map();
  $$(".fact .n, .act .stat").forEach(n => {
    const node = n.firstChild, [, num, suffix] = node.data.match(/^([\d.]+)(.*)$/);
    counters.set(n.closest(".reveal"), {node, to:+num, dec:(num.split(".")[1] || "").length, suffix, text:node.data});
  });
  function countUp(block, c){
    const t0 = performance.now();
    const tick = t => {
      const p = Math.min(1, (t - t0) / 1500);
      if (p < 1 && block.classList.contains("in")){
        c.node.data = (c.to * (1 - Math.pow(1 - p, 4))).toFixed(c.dec) + c.suffix;
        requestAnimationFrame(tick);
      } else c.node.data = c.text;
    };
    requestAnimationFrame(tick);
  }

  const seen = new IntersectionObserver(entries => entries.forEach(e => {
    const b = e.target;
    if (e.intersectionRatio >= .12){
      if (b.classList.contains("in")) return;
      b.classList.add("in");
      if (counters.has(b)) countUp(b, counters.get(b));
    } else if (!e.isIntersecting){
      // Reset off screen, ready to ease in from whichever side it left by.
      b.classList.remove("in");
      b.classList.toggle("from-above", e.boundingClientRect.top < 0);
    }
  }), {threshold:[0, .12]});
  blocks.forEach(b => seen.observe(b));
}

})();
