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
  
// Attach checkbox listener once at init
normalizeStartCheckbox.addEventListener("change", () => {
  if (!window.lastRouteChartState) {
    return;
  }

  drawElevationChart(
    window.lastRouteChartState.distances,
    window.lastRouteChartState.elevations,
    getActiveClimbs(),
    normalizeStartCheckbox.checked
  );
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
    drawElevationChart(
      distances,
      elevations,
      getActiveClimbs(),
      isNormalizeStartEnabled()
    );

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
function drawElevationChart(
  distances,
  elevations,
  climbs = [],
  normalizeStart = false
) {
  if (elevationChart) {
    elevationChart.destroy();
  }

  const ctx = chartCanvas.getContext("2d");

  const routeDistance =
    distances && distances.length
      ? Number(distances[distances.length - 1])
      : 0;

  const climbDistances = climbs
    .map(climb => Number(climb.distance_km) || 0)
    .filter(distance => distance > 0);

  const maxDistance = Math.max(routeDistance, ...climbDistances, 0);

  if (!maxDistance || !distances?.length || !elevations?.length) {
    return;
  }

  const N = 200;

  // Shared distance locations from 0 through the longest selected profile.
  const sharedDistances = Array.from(
    { length: N },
    (_, i) => (i / (N - 1)) * maxDistance
  );

  function resampleSeries(sourceDistances, sourceElevations) {
    if (
      !sourceDistances ||
      !sourceElevations ||
      sourceDistances.length === 0 ||
      sourceElevations.length === 0 ||
      sourceDistances.length !== sourceElevations.length
    ) {
      return new Array(N).fill(null);
    }

    const lastDistance = Number(sourceDistances[sourceDistances.length - 1]);
    const result = new Array(N).fill(null);

    let sourceIndex = 0;

    for (let i = 0; i < N; i++) {
      const distance = sharedDistances[i];

      // Do not extend a profile beyond its actual end.
      if (distance > lastDistance) {
        continue;
      }

      while (
        sourceIndex < sourceDistances.length - 2 &&
        Number(sourceDistances[sourceIndex + 1]) < distance
      ) {
        sourceIndex++;
      }

      const x0 = Number(sourceDistances[sourceIndex]);
      const y0 = Number(sourceElevations[sourceIndex]);
      const x1 = Number(sourceDistances[sourceIndex + 1] ?? x0);
      const y1 = Number(sourceElevations[sourceIndex + 1] ?? y0);

      if (x1 === x0) {
        result[i] = y0;
      } else {
        const position = (distance - x0) / (x1 - x0);
        result[i] = y0 + (y1 - y0) * position;
      }
    }

    return result;
  }

  function normalizeSeries(series) {
    if (!normalizeStart) {
      return series;
    }

    const firstValue = series.find(value => value !== null && Number.isFinite(value));

    if (firstValue === undefined) {
      return series;
    }

    return series.map(value =>
      value === null ? null : value - firstValue
    );
  }

  function makePoints(series) {
    return series
      .map((elevation, index) => {
        if (elevation === null || !Number.isFinite(elevation)) {
          return null;
        }

        return {
          x: sharedDistances[index],
          y: elevation
        };
      })
      .filter(Boolean);
  }

  const routeSeries = normalizeSeries(
    resampleSeries(distances, elevations)
  );

  const datasets = [
    {
      label: "Route",
      data: makePoints(routeSeries),
      borderColor: "#1976D2",
      backgroundColor: "rgba(25, 118, 210, 0.10)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: true,
      tension: 0.15
    }
  ];

  const colors = [
    "#E91E63",
    "#FF9800",
    "#4CAF50",
    "#9C27B0",
    "#00BCD4"
  ];

  climbs.forEach((climb, index) => {
    if (!Array.isArray(climb.profile) || climb.profile.length === 0) {
      return;
    }

    const distanceKm = Number(climb.distance_km);

    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return;
    }

    const profileDistances = Array.from(
      { length: climb.profile.length },
      (_, i) => {
        if (climb.profile.length === 1) {
          return 0;
        }

        return (i / (climb.profile.length - 1)) * distanceKm;
      }
    );

    const climbSeries = normalizeSeries(
      resampleSeries(profileDistances, climb.profile)
    );

    datasets.push({
      label: climb.name || "Reference climb",
      data: makePoints(climbSeries),
      borderColor: colors[index % colors.length],
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: false,
      tension: 0.15
    });
  });

  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      normalized: true,
      interaction: {
        mode: "nearest",
        intersect: false
      },
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            title: tooltipItems => {
              const distance = tooltipItems[0]?.parsed?.x;

              return Number.isFinite(distance)
                ? `${distance.toFixed(2)} km`
                : "";
            },
            label: tooltipContext => {
              const elevation = tooltipContext.parsed.y;

              return `${tooltipContext.dataset.label}: ${elevation.toFixed(0)} m`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: maxDistance,
          title: {
            display: true,
            text: "Distance (km)"
          },
          ticks: {
            maxTicksLimit: 6,
            callback: value => `${Number(value).toFixed(1)} km`
          }
        },
        y: {
          title: {
            display: true,
            text: normalizeStart
              ? "Elevation relative to start (m)"
              : "Elevation (m)"
          },
          ticks: {
            callback: value => `${value} m`
          }
        }
      }
    }
  });
}

// =========================
// Normalisation Check
// =========================
function isNormalizeStartEnabled() {
  return Boolean(
    normalizeStartCheckbox &&
    normalizeStartCheckbox.checked
  );
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
          distances,
          elevations,
          getActiveClimbs(),
          isNormalizeStartEnabled()
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
