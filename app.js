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

// =========================
// REFERENCE CLIMBS (hardcoded for now)
// =========================
// Each climb: { id, name, distance_km, ascent_m, descent_m, profile: [elevations...] }
// profile is elevation in metres at each XXm (or other fixed step).

const REFERENCE_CLIMBS = [
  {
    id: "Austria",
    name: "Austria Border Crossing",
    distance_km: 23.8,
    ascent_m: 1870,
    descent_m: 120,
    // Example: elevation every 1 km (25 points for 24.3 km, approximated)
    profile: [
      900, 950, 1000, 1050, 1100, 1200, 1300, 1400, 1500, 1600,
      1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600,
      2700, 2750, 2759, 2750, 2700
    ]
  },
  {
    id: "alpe_dhuez",
    name: "Alpe d’Huez",
    distance_km: 13.8,
    ascent_m: 1070,
    descent_m: 30,
    profile: [
      720, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600,
      1700, 1750, 1800, 1850, 1860
    ]
  },
  {
    id: "mont_ventoux",
    name: "Mont Ventoux (Bédoin)",
    distance_km: 21.5,
    ascent_m: 1610,
    descent_m: 50,
    profile: [
      300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200,
      1300, 1400, 1500, 1600, 1700, 1800, 1900, 1950, 2000, 2050, 2100, 2116
    ]
  }
];

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

    // DEBUG: log the full result
    console.log("Directions result:", JSON.stringify(dirResult, null, 2));

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
function drawElevationChart(distances, elevations, climbs = []) {
  if (elevationChart) {
    elevationChart.destroy();
  }

  const ctx = chartCanvas.getContext("2d");

  const datasets = [];

  // Main route
  datasets.push({
    label: "Route",
    data: elevations,
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

    // Resample climb profile to match route’s x‑axis length for display
    // For simplicity, we just map climb profile to its own distance range.
    const climbDistances = [];
    const step = climb.distance_km / (climb.profile.length - 1);
    for (let i = 0; i < climb.profile.length; i++) {
      climbDistances.push(i * step);
    }

    datasets.push({
      label: climb.name,
      data: climb.profile,
      borderColor: color,
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      hidden: false
    });
  });

  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: distances.map(d => d.toFixed(1)),
      datasets
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ": " + ctx.parsed.y.toFixed(0) + " m"
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Distance (km)" }
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
