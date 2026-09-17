// =========================
// CONFIG
// =========================
// API key is already loaded via the Maps script tag in index.html

// =========================
// STATE
// =========================
let waypoints = [];
let map;
let routePolyline;
let elevationChart;
let directionsService;
let elevationService;

// =========================
// DOM ELEMENTS
// =========================
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
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  waypointsListEl = document.getElementById("waypoints-list");
  addWaypointBtn = document.getElementById("add-waypoint-btn");
  buildRouteBtn = document.getElementById("build-route-btn");
  editWaypointsBtn = document.getElementById("edit-waypoints-btn");
  waypointsSection = document.getElementById("waypoints-section");
  routeSection = document.getElementById("route-section");
  summaryEl = document.getElementById("summary");
  mapEl = document.getElementById("map");
  chartCanvas = document.getElementById("elevation-chart");

  // Initialize with two waypoints
  waypoints = [{ value: "" }, { value: "" }];
  renderWaypoints();

  addWaypointBtn.addEventListener("click", () => {
    waypoints.push({ value: "" });
    renderWaypoints();
  });

  buildRouteBtn.addEventListener("click", buildRoute);
  editWaypointsBtn.addEventListener("click", () => {
    routeSection.style.display = "none";
    waypointsSection.style.display = "block";
  });

  // Init map when Google script loads
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
    input.value = wp.value;
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

  const raw = waypoints.map(w => (w && w.value ? w.value.trim() : "")).filter(v => v.length > 0);
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

    // Directions via DirectionsService
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
    const route = dirResult.routes[0];
    const overviewPolyline = route.overview_polyline.points;

    // Draw route on map
    const path = google.maps.geometry.encoding.decodePath(overviewPolyline);
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

    // Distance from legs
    let totalDistanceM = 0;
    for (const leg of route.legs) {
      totalDistanceM += leg.distance.value;
    }

    // Elevation along path via ElevationService
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
      distances.push((i * step) / 1000); // km
    }

    // Ascent / descent
    let totalAscent = 0;
    let totalDescent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const dz = elevations[i] - elevations[i - 1];
      if (dz > 0) totalAscent += dz;
      else totalDescent += -dz;
    }

    // Draw elevation chart
    drawElevationChart(distances, elevations);

    // Summary
    summaryEl.innerHTML =
      "Distance: " + (totalDistanceM / 1000).toFixed(1) + " km | " +
      "Ascent: " + Math.round(totalAscent) + " m | " +
      "Descent: " + Math.round(totalDescent) + " m";

    // Switch views
    waypointsSection.style.display = "none";
    routeSection.style.display = "block";
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  } finally {
    buildRouteBtn.disabled = false;
    buildRouteBtn.textContent = "Build route";
  }
}

function drawElevationChart(distances, elevations) {
  if (elevationChart) {
    elevationChart.destroy();
  }
  const ctx = chartCanvas.getContext("2d");
  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: distances.map(d => d.toFixed(1)),
      datasets: [{
        label: "Elevation (m)",
        data: elevations,
        borderColor: "#1976D2",
        backgroundColor: "rgba(25, 118, 210, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y.toFixed(0) + " m"
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Distance (km)"
          }
        },
        y: {
          title: {
            display: true,
            text: "Elevation (m)"
          }
        }
      }
    }
  });
}

// initMap is assigned in DOMContentLoaded