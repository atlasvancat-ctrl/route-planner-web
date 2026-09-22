// =========================
// STATE
// =========================
let waypoints = [];
let map;
let routePolyline;
let elevationChart;
let directionsService;
let elevationService;
let lastRouteChartState = null; // { distances, elevations }
let normalizeStartCheckbox;

// DOM elements (will be set in init)
let waypointsListEl;
let addWaypointBtn;
let buildRouteBtn;
let editWaypointsBtn;
let waypointsSection;
let routeSection;
let summaryEl;
let mapEl;
let chartCanvas;
let exportClimbSection, exportClimbBtn, climbNameInput, climbIdInput;
let climbsFileInput, importStatusEl;

// =========================
// REFERENCE CLIMBS
// =========================
// This will be populated from climbs.json at startup
const REFERENCE_CLIMBS = [];

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  // Cache DOM elements
  waypointsListEl = document.getElementById("waypoints-list");
  addWaypointBtn = document.getElementById("add-waypoint-btn");
  buildRouteBtn = document.getElementById("build-route-btn");
  editWaypointsBtn = document.getElementById("edit-waypoints-btn");
  waypointsSection = document.getElementById("waypoints-section");
  routeSection = document.getElementById("route-section");
  summaryEl = document.getElementById("summary");
  mapEl = document.getElementById("map");
  chartCanvas = document.getElementById("elevation-chart");
  climbsListEl = document.getElementById("climbs-list");
  renderClimbToggles();
  exportClimbSection = document.getElementById("export-climb-section");
  exportClimbBtn = document.getElementById("export-climb-btn");
  climbNameInput = document.getElementById("climb-name-input");
  climbIdInput = document.getElementById("climb-id-input");
  climbsFileInput = document.getElementById("climbs-file-input");
  importStatusEl = document.getElementById("import-status");
  loadDefaultClimbs();
  normalizeStartCheckbox = document.getElementById("normalize-start-checkbox");
  if (!normalizeStartCheckbox) {
    console.error("normalize-start-checkbox NOT FOUND in DOM");
  } else {
    console.log("normalize-start-checkbox FOUND:", normalizeStartCheckbox);
  }

  climbsFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
  
    try {
      const text = await file.text();
      const data = JSON.parse(text);
  
      let climbsArray;
      if (Array.isArray(data)) {
        climbsArray = data;
      } else if (data && typeof data === "object" && !Array.isArray(data)) {
        // Single climb object
        climbsArray = [data];
      } else {
        throw new Error("Invalid climbs JSON format.");
      }
  
      // Basic validation
      climbsArray.forEach((c, i) => {
        if (!c.id || !c.name || !Array.isArray(c.profile)) {
          throw new Error("Climb " + (i + 1) + " is missing required fields (id, name, profile).");
        }
      });
  
      // Merge into REFERENCE_CLIMBS
      // Avoid duplicates by id
      const existingIds = new Set(REFERENCE_CLIMBS.map(c => c.id));
      let added = 0;
      climbsArray.forEach(c => {
        if (!existingIds.has(c.id)) {
          REFERENCE_CLIMBS.push(c);
          existingIds.add(c.id);
          added++;
        }
      });
  
      importStatusEl.textContent =
        "Loaded " + climbsArray.length + " climb(s), added " + added + " new.";
  
      // Re-render climb toggles
      renderClimbToggles();
    } catch (err) {
      console.error(err);
      importStatusEl.textContent = "Error loading climbs: " + err.message;
    }
  });
  exportClimbBtn.addEventListener("click", () => {
    if (!window.lastRouteChartState) {
      alert("No route loaded yet.");
      return;
    }
    const name = climbNameInput.value.trim() || "Unnamed climb";
    let id = climbIdInput.value.trim();
    if (!id) {
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    }
  
    const { distances, elevations } = window.lastRouteChartState;
    const distance_km = distances[distances.length - 1] || 0;
    const ascent_m = computeAscent(elevations);
    const descent_m = computeDescent(elevations);
  
    const climb = {
      id,
      name,
      distance_km: Number(distance_km.toFixed(2)),
      ascent_m: Number(ascent_m.toFixed(0)),
      descent_m: Number(descent_m.toFixed(0)),
      profile: elevations.map(e => Number(e.toFixed(1)))
    };

    normalizeStartCheckbox.addEventListener("change", () => {
      console.log("Checkbox changed, checked =", normalizeStartCheckbox.checked);
      console.log("elevationChart =", elevationChart);
      console.log("lastRouteChartState =", window.lastRouteChartState);
    // Redraw chart with current data if it exists
    if (elevationChart && window.lastRouteChartState) {
      console.log("Calling drawElevationChart with normalizeStart =", normalizeStartCheckbox.checked);
      drawElevationChart(
        window.lastRouteChartState.distances,
        window.lastRouteChartState.elevations,
        getActiveClimbs(),
        normalizeStartCheckbox.checked
      );
    } else {
      console.log("Not redrawing: missing chart or route state");
    }
  });
    
    const json = JSON.stringify(climb, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
  
    const a = document.createElement("a");
    a.href = url;
    a.download = (id || "climb") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Initialize with two waypoints
  waypoints = [{ value: "" }, { value: "" }];
  renderWaypoints();

  // Event listeners
  addWaypointBtn.addEventListener("click", () => {
    waypoints.push({ value: "" });
    renderWaypoints();
  });

  buildRouteBtn.addEventListener("click", buildRoute);
  editWaypointsBtn.addEventListener("click", () => {
    routeSection.style.display = "none";
    waypointsSection.style.display = "block";
  });

  // Expose init for Maps callback
  window.initMap = initMapAndServices;
});

// =========================
// WAYPOINT UI
// =========================
function renderWaypoints() {
  if (!waypointsListEl) return;
  waypointsListEl.innerHTML = "";

  waypoints.forEach((wp, idx) => {
    const row = document.createElement("div");
    row.className = "waypoint-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = wp.value || "";
    input.placeholder = "lat,lon / Plus Code / place name";
    input.addEventListener("input", () => {
      waypoints[idx].value = input.value;
    });

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", () => {
      if (idx === 0) return;
      const tmp = waypoints[idx - 1];
      waypoints[idx - 1] = waypoints[idx];
      waypoints[idx] = tmp;
      renderWaypoints();
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = idx === waypoints.length - 1;
    downBtn.addEventListener("click", () => {
      if (idx === waypoints.length - 1) return;
      const tmp = waypoints[idx + 1];
      waypoints[idx + 1] = waypoints[idx];
      waypoints[idx] = tmp;
      renderWaypoints();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      waypoints.splice(idx, 1);
      renderWaypoints();
    });

    row.appendChild(input);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(delBtn);
    waypointsListEl.appendChild(row);
  });
}

// =========================
// MAP & SERVICES INIT
// =========================
function initMapAndServices() {
  if (map) return;
  if (!mapEl) return;

  map = new google.maps.Map(mapEl, {
    center: { lat: 44, lng: 18 },
    zoom: 7
  });

  directionsService = new google.maps.DirectionsService();
  elevationService = new google.maps.ElevationService();
}

// =========================
// BUILD ROUTE
// =========================
async function buildRoute() {
  if (!Array.isArray(waypoints)) {
    alert("Waypoints not initialized. Please reload the page.");
    return;
  }

  const raw = waypoints
    .map(w => (w && w.value ? w.value.trim() : ""))
    .filter(v => v.length > 0);

  if (raw.length < 2) {
    alert("Please enter at least 2 waypoints.");
    return;
  }

  const origin = raw[0];
  const destination = raw[raw.length - 1];
  const waypointsParam = raw.slice(1, -1);

  buildRouteBtn.disabled = true;
  buildRouteBtn.textContent = "Building...";

  try {
    initMapAndServices();

    const request = {
      origin,
      destination,
      travelMode: google.maps.TravelMode.DRIVING
    };

    if (waypointsParam.length > 0) {
      request.waypoints = waypointsParam.map(loc => ({
        location: loc,
        stopover: true
      }));
    }

    const dirResult = await directionsService.route(request);

    if (!dirResult || !dirResult.routes || dirResult.routes.length === 0) {
      throw new Error("No routes found for these waypoints.");
    }

    const route = dirResult.routes[0];
    
    if (!route.overview_path || route.overview_path.length < 2) {
      throw new Error("Route data is incomplete: no overview path was returned.");
    }
    
    // overview_path is already an array of google.maps.LatLng objects.
    const path = route.overview_path;

    if (routePolyline) routePolyline.setMap(null);
    routePolyline = new google.maps.Polyline({
      path,
      map,
      geodesic: true,
      strokeColor: "#1976D2",
      strokeWeight: 4,
      strokeOpacity: 0.8
    });

    const bounds = new google.maps.LatLngBounds();
    for (const latLng of path) {
      bounds.extend(latLng);
    }
    map.fitBounds(bounds);

    let totalDistanceM = 0;
    for (const leg of route.legs) {
      totalDistanceM += leg.distance.value;
    }

    const elevationRequest = {
      path: path,
      samples: 200
    };

    const elevResult = await new Promise((resolve, reject) => {
      elevationService.getElevationAlongPath(elevationRequest, (results, status) => {
        if (status === google.maps.ElevationStatus.OK) {
          resolve(results);
        } else {
          reject(new Error("Elevation error: " + status));
        }
      });
    });

    const elevations = elevResult.map(r => r.elevation);
    const distances = [];
    const step = totalDistanceM / (elevations.length - 1);
    for (let i = 0; i < elevations.length; i++) {
      distances.push((i * step) / 1000);
    }

    let totalAscent = 0;
    let totalDescent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const dz = elevations[i] - elevations[i - 1];
      if (dz > 0) totalAscent += dz;
      else totalDescent += -dz;
    }
    
    window.lastRouteChartState = { distances, elevations };
    drawElevationChart(distances, elevations, getActiveClimbs());

    summaryEl.innerHTML =
      "Distance: " + (totalDistanceM / 1000).toFixed(1) + " km | " +
      "Ascent: " + Math.round(totalAscent) + " m | " +
      "Descent: " + Math.round(totalDescent) + " m";

    waypointsSection.style.display = "none";
    routeSection.style.display = "block";
    document.getElementById("climbs-section").style.display = "block";
    exportClimbSection.style.display = "block";
    document.getElementById("chart-options-section").style.display = "block";
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  } finally {
    buildRouteBtn.disabled = false;
    buildRouteBtn.textContent = "Build route";
  }
}

// =========================
// ELEVATION CHART
// =========================
function drawElevationChart(distances, elevations, climbs = [], normalizeStart = false) {
  if (elevationChart) {
    elevationChart.destroy();
  }

  const ctx = chartCanvas.getContext("2d");

  // 1. Determine max distance across route and active climbs
  const routeDistance = distances.length > 0 ? distances[distances.length - 1] : 0;
  let maxDistance = routeDistance;

  climbs.forEach(c => {
    if (c.distance_km > maxDistance) {
      maxDistance = c.distance_km;
    }
  });

  if (maxDistance <= 0) {
    // Nothing meaningful to plot
    return;
  }

  // 2. Choose a fixed number of points for the shared X axis
  const N = 200; // resolution of the chart
  const sharedDistances = [];
  for (let i = 0; i < N; i++) {
    sharedDistances.push((i / (N - 1)) * maxDistance);
  }

  // Helper: resample (x, y) onto sharedDistances by linear interpolation
  function resampleSeries(x, y) {
    if (!x || !y || x.length === 0 || y.length === 0 || x.length !== y.length) {
      return new Array(N).fill(null);
    }

    const out = new Array(N).fill(null);

    for (let i = 0; i < N; i++) {
      const d = sharedDistances[i];

      // If beyond the series’ max distance, leave as null
      if (d > x[x.length - 1]) {
        continue;
      }

      // Find segment [x0, x1] containing d
      let j = 0;
      while (j < x.length - 1 && x[j + 1] < d) {
        j++;
      }

      const x0 = x[j];
      const x1 = x[j + 1];
      const y0 = y[j];
      const y1 = y[j + 1];

      if (x1 === x0) {
        out[i] = y0;
      } else {
        const t = (d - x0) / (x1 - x0);
        out[i] = y0 + t * (y1 - y0);
      }
    }

    return out;
  }

  // 3. Build shared X labels
  const labels = sharedDistances.map(d => d.toFixed(1));

  // 4. Resample route profile
  const routeResampled = resampleSeries(distances, elevations);
  // Optionally normalize so all profiles start at 0
  if (normalizeStart) {
    // Compute start elevation for route (first non-null value)
    let routeStart = null;
    for (let i = 0; i < routeResampled.length; i++) {
      if (routeResampled[i] != null) {
        routeStart = routeResampled[i];
        break;
      }
    }
  
    if (routeStart != null) {
      for (let i = 0; i < routeResampled.length; i++) {
        if (routeResampled[i] != null) {
          routeResampled[i] -= routeStart;
        }
      }
    }
  }
  // 5. Build datasets
  const datasets = [];

  // Main route
  datasets.push({
    label: "Route",
    data: routeResampled,
    borderColor: "#1976D2",
    backgroundColor: "rgba(25, 118, 210, 0.1)",
    borderWidth: 2,
    pointRadius: 0,
    fill: true
  });

  // Reference climbs
  const colors = [
    "#E91E63", // pink
    "#FF9800", // orange
    "#4CAF50", // green
    "#9C27B0", // purple
    "#00BCD4"  // cyan
  ];

  climbs.forEach((climb, idx) => {
    const color = colors[idx % colors.length];

    // Build climb distance axis
    const climbDistances = [];
    const step = climb.distance_km / (climb.profile.length - 1);
    for (let i = 0; i < climb.profile.length; i++) {
      climbDistances.push(i * step);
    }

    const climbResampled = resampleSeries(climbDistances, climb.profile);
  if (normalizeStart) {
    // Normalize climb so its first non-null elevation is 0
    let climbStart = null;
    for (let i = 0; i < climbResampled.length; i++) {
      if (climbResampled[i] != null) {
        climbStart = climbResampled[i];
        break;
      }
    }
  
    if (climbStart != null) {
      for (let i = 0; i < climbResampled.length; i++) {
        if (climbResampled[i] != null) {
          climbResampled[i] -= climbStart;
        }
      }
    }
  }
    datasets.push({
      label: climb.name,
      data: climbResampled,
      borderColor: color,
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      fill: false
    });
  });

  // 6. Create chart
  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed.y;
              if (val == null) return ctx.dataset.label + ": –";
              return ctx.dataset.label + ": " + val.toFixed(0) + " m";
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Distance (km)" },
          min: 0,
          max: maxDistance
        },
        y: {
          title: { display: true, text: "Elevation (m)" }
        }
      }
    }
  });
}
// =========================
// Climb Toggles
// =========================
function renderClimbToggles() {
  if (!climbsListEl) return;
  climbsListEl.innerHTML = "";

  REFERENCE_CLIMBS.forEach((climb, idx) => {
    const row = document.createElement("div");
    row.className = "waypoint-row"; // reuse basic styling

    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "0.5rem";
    label.style.flex = "1";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.climbId = climb.id;
    checkbox.checked = false; // default off
    checkbox.addEventListener("change", () => {
      // Redraw chart with current route if it exists
      if (elevationChart && window.lastRouteChartState) {
        drawElevationChart(
          window.lastRouteChartState.distances,
          window.lastRouteChartState.elevations,
          getActiveClimbs()
        );
      }
    });

    const text = document.createElement("span");
    text.textContent =
      climb.name +
      " (" +
      climb.distance_km.toFixed(1) +
      " km, +" +
      Math.round(climb.ascent_m) +
      " m)";

    label.appendChild(checkbox);
    label.appendChild(text);
    row.appendChild(label);

    climbsListEl.appendChild(row);
  });
}

// =========================
// Get active Climbs
// =========================
function getActiveClimbs() {
  const checkboxes = document.querySelectorAll('#climbs-list input[type="checkbox"]');
  const active = [];
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const climb = REFERENCE_CLIMBS.find(c => c.id === cb.dataset.climbId);
      if (climb) active.push(climb);
    }
  });
  return active;
}

// =========================
// Compute Ascent
// =========================
function computeAscent(elevs) {
  let total = 0;
  for (let i = 1; i < elevs.length; i++) {
    const dz = elevs[i] - elevs[i - 1];
    if (dz > 0) total += dz;
  }
  return total;
}

// =========================
// Compute Descent
// =========================
function computeDescent(elevs) {
  let total = 0;
  for (let i = 1; i < elevs.length; i++) {
    const dz = elevs[i] - elevs[i - 1];
    if (dz < 0) total += -dz;
  }
  return total;
}

// =========================
// Load Default Climbs
// =========================
async function loadDefaultClimbs() {
  try {
    const res = await fetch("climbs.json");
    if (!res.ok) {
      // File not found or error – that’s OK, just no default climbs.
      console.warn("No climbs.json found or failed to load:", res.status);
      return;
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn("climbs.json is not an array; ignoring.");
      return;
    }

    const existingIds = new Set(REFERENCE_CLIMBS.map(c => c.id));

    data.forEach((c, i) => {
      if (!c || !c.id || !c.name || !Array.isArray(c.profile)) {
        console.warn("Skipping invalid climb at index", i, c);
        return;
      }
      if (!existingIds.has(c.id)) {
        REFERENCE_CLIMBS.push(c);
        existingIds.add(c.id);
      }
    });

    // Re-render climb toggles now that we have data
    renderClimbToggles();
  } catch (e) {
    console.warn("Error loading climbs.json:", e);
  }
}
